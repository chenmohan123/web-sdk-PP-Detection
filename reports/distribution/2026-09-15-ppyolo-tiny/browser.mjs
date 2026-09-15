// 双源真实下载、两后端和两执行模式验证；每组使用独立缓存空间。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
import { classifyAdapter } from "../../../tools/model-pipeline/browser/evaluation-runner.mjs";

const report = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(report, "../../..");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const manifestPath = "models/ppyolo-tiny-320/0.1.0/manifest.json";
const manifestBytes = await readFile(resolve(root, manifestPath));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.model.id, "ppyolo-tiny-320");
assert.equal(manifest.model.version, "0.1.0");
assert.equal(manifest.status, "stable");
assert.equal(manifest.variants.length, 1);
const variant = manifest.variants[0];
assert.equal(variant.id, "fp32");
assert.equal(variant.bytes, 4511117);
assert.equal(variant.sha256, "1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653");
assert.deepEqual(variant.sources.map((s) => s.kind).sort(), ["huggingface", "modelscope"]);
for (const source of variant.sources) {
  assert.match(source.revision, /^[a-f0-9]{40}$/);
  assert(source.downloadUrl.includes(`/resolve/${source.revision}/`));
  assert.equal(source.sha256, variant.sha256);
  assert.equal(source.bytes, variant.bytes);
}
const sdkSha256 = sha(await readFile(resolve(root, "packages/sdk/dist/browser-global.js")));
assert.equal(sdkSha256, "c2b6a9733416571c77c8dc48fa68028251e5d8cccb201047c8387bf9433e1189");
const routes = new Map();
for (const [prefix, relative] of [
  ["/dist/", "packages/sdk/dist"],
  ["/ort/", "packages/sdk/node_modules/onnxruntime-web/dist"],
  ["/samples/", "apps/demo/public/samples"]
]) {
  for (const name of await readdir(resolve(root, relative)))
    routes.set(prefix + name, resolve(root, relative, name));
}
const result = {
  capturedAt: new Date().toISOString(),
  status: "running",
  scope:
    "双源×CPU/GPU×main/Worker：真实下载与SHA-256、预取消/恢复、释放/重复释放、缓存命中和两种清理；不覆盖进行中取消竞态、手机或NPU",
  sdkSha256,
  workerSha256: sha(await readFile(resolve(root, "packages/sdk/dist/inference.worker.js"))),
  modelSha256: variant.sha256,
  modelBytes: variant.bytes,
  manifest: manifestPath,
  manifestSha256: sha(manifestBytes),
  protocolSha256: sha(await readFile(resolve(report, "protocol.json"))),
  receiptSha256: sha(await readFile(resolve(report, "prepare-receipt.json"))),
  sample: { name: "people.jpg", sha256: sha(await readFile(routes.get("/samples/people.jpg"))) },
  os: os.release(),
  cpu: os.cpus()[0].model,
  rows: []
};
const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Tiny分发验证</title><script src="/dist/browser-global.js"></script></html>'
    );
    return;
  }
  const path = routes.get(req.url);
  if (!path) return res.writeHead(404).end();
  const types = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".jpg": "image/jpeg"
  };
  res.writeHead(200, {
    "Content-Type": types[extname(path)] ?? "application/octet-stream",
    "Content-Length": (await stat(path)).size
  });
  createReadStream(path).pipe(res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  result.browser = browser.version();
  const references = new Map();
  for (const sourceKind of ["modelscope", "huggingface"]) {
    for (const backend of ["wasm", "webgpu"]) {
      for (const executionMode of ["main", "worker"]) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(origin);
          const row = await page.evaluate(
            async ({ manifest, sourceKind, backend, executionMode, origin }) => {
              const invariant = (ok, message) => {
                if (!ok) throw new Error(message);
              };
              const adapter =
                backend === "webgpu"
                  ? await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })
                  : null;
              const info = adapter?.info;
              const adapterIdentity = info
                ? {
                    vendor: info.vendor,
                    architecture: info.architecture,
                    device: info.device,
                    description: info.description,
                    isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? false
                  }
                : null;
              await PPDetection.clearModelCache();
              const blob = await (await fetch("/samples/people.jpg")).blob();
              const options = {
                manifest,
                source: sourceKind,
                backend,
                executionMode,
                precision: "fp32",
                allowExperimental: false,
                allowFallback: false,
                cache: true,
                ort: { wasm: { paths: `${origin}/ort/`, numThreads: 1 } }
              };
              let detector;
              try {
                detector = await PPDetection.createPPDetection(options);
                const firstLoad = { ...detector.loadTimings };
                const firstCache = await detector.getCacheEstimate();
                invariant(firstLoad.modelSource === "network", "首次会话必须真实下载");
                const detected = await detector.detect(blob, { threshold: 0.5 });
                const aborter = new AbortController();
                aborter.abort();
                let abortCode;
                try {
                  await detector.detect(blob, { signal: aborter.signal });
                } catch (error) {
                  abortCode = error.code;
                }
                const recovered = await detector.detect(blob, { threshold: 0.5 });
                await detector.dispose();
                await detector.dispose();
                let disposedCode;
                try {
                  await detector.detect(blob);
                } catch (error) {
                  disposedCode = error.code;
                }
                detector = await PPDetection.createPPDetection(options);
                const cachedLoad = { ...detector.loadTimings };
                invariant(cachedLoad.modelSource === "cache", "第二会话必须命中缓存");
                const cached = await detector.detect(blob, { threshold: 0.5 });
                await detector.clearCurrentModelCache();
                const afterCurrentClear = await detector.getCacheEstimate();
                await detector.dispose();
                detector = await PPDetection.createPPDetection(options);
                const reloaded = { ...detector.loadTimings };
                const reloadedCache = await detector.getCacheEstimate();
                invariant(reloaded.modelSource === "network", "清理后必须重新下载");
                await detector.clearAllCache();
                const afterAllClear = await detector.getCacheEstimate();
                return {
                  sourceKind,
                  backend,
                  executionMode,
                  adapterIdentity,
                  runtime: detected.runtime,
                  model: detected.model,
                  detections: detected.detections,
                  recovered: recovered.detections,
                  cached: {
                    detections: cached.detections,
                    runtime: cached.runtime,
                    model: cached.model
                  },
                  abortCode,
                  disposedCode,
                  firstLoad,
                  cachedLoad,
                  reloaded,
                  firstCache,
                  reloadedCache,
                  afterCurrentClear,
                  afterAllClear,
                  timings: detected.timings,
                  userAgent: navigator.userAgent
                };
              } finally {
                await detector?.dispose();
              }
            },
            { manifest, sourceKind, backend, executionMode, origin }
          );
          assert.deepEqual(errors, []);
          if (backend === "webgpu")
            assert(classifyAdapter(row.adapterIdentity).physical, "必须使用物理GPU");
          const source = variant.sources.find((s) => s.kind === sourceKind);
          for (const detection of [row, row.cached]) {
            assert.equal(detection.runtime.backend, backend);
            assert.equal(detection.runtime.requestedBackend, backend);
            assert.equal(detection.runtime.mode, executionMode);
            assert.equal(detection.runtime.precision, "fp32");
            assert.deepEqual(detection.runtime.fallbacks, []);
            assert.equal(detection.model.id, manifest.model.id);
            assert.equal(detection.model.version, manifest.model.version);
            assert.equal(detection.model.variantId, "fp32");
            assert.equal(detection.model.bytes, variant.bytes);
            assert.equal(detection.model.source.kind, sourceKind);
            assert.equal(detection.model.source.revision, source.revision);
            assert.equal(detection.model.source.sha256, variant.sha256);
          }
          assert.equal(row.abortCode, "ABORTED");
          assert.equal(row.disposedCode, "DISPOSED");
          assert(row.detections.some((d) => d.label === "person"));
          assert.deepEqual(row.detections, row.recovered);
          assert.deepEqual(row.detections, row.cached.detections);
          for (const timing of [row.firstLoad, row.cachedLoad, row.reloaded])
            assert(Number.isFinite(timing.integrityMs) && timing.integrityMs >= 0);
          for (const cache of [row.firstCache, row.reloadedCache])
            assert.deepEqual(cache, { entries: 1, bytes: variant.bytes });
          for (const cache of [row.afterCurrentClear, row.afterAllClear])
            assert.deepEqual(cache, { entries: 0, bytes: 0 });
          if (references.has(backend)) assert.deepEqual(row.detections, references.get(backend));
          else references.set(backend, row.detections);
          result.rows.push({ ...row, status: "passed" });
          console.log(sourceKind, backend, executionMode, row.detections.length, "通过");
        } finally {
          await context.close();
        }
      }
    }
  }
  assert.equal(result.rows.length, 8);
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = String(error);
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(resolve(report, "browser.json"), JSON.stringify(result, null, 2) + "\n");
}
