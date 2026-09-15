import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const report = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(report, "../../..");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tmp/dependencies-compatible-browsers");
const { chromium } = await import("playwright");

const routes = new Map();
for (const [prefix, directory] of [
  ["/dist/", "packages/sdk/dist"],
  ["/ort/", "packages/sdk/node_modules/onnxruntime-web/dist"],
  ["/samples/", "apps/demo/public/samples"]
]) {
  for (const name of await readdir(resolve(root, directory)))
    routes.set(prefix + name, resolve(root, directory, name));
}
// 使用已固定双来源的最终清单进行本地生命周期验证。
const jobPath = process.env.PICODET_LIFECYCLE_JOBS || resolve(report, "jobs.json");
const jobs = JSON.parse(await readFile(jobPath, "utf8")).filter((j) => j.precision !== "fp32");
const outName = process.env.PICODET_LIFECYCLE_OUTPUT || "lifecycle-candidates.json";
assert(jobs.length > 0 && new Set(jobs.map((j) => `${j.key}-${j.precision}`)).size === jobs.length);
const lock = JSON.parse(await readFile(resolve(report, "inputs.lock.json"), "utf8"));
assert.equal(
  createHash("sha256")
    .update(await readFile(resolve(root, "packages/sdk/dist/browser-global.js")))
    .digest("hex"),
  lock.sdkSha256
);
for (const job of jobs)
  routes.set(`/model/${job.key}-${job.precision}.onnx`, resolve(root, job.model));
const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><script src="/dist/browser-global.js"></script>');
    return;
  }
  const file = routes.get(req.url);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  const mime = file.endsWith(".wasm")
    ? "application/wasm"
    : /\.(m?js)$/.test(file)
      ? "text/javascript"
      : file.endsWith(".jpg")
        ? "image/jpeg"
        : "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Content-Length": (await stat(file)).size });
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium", headless: true });
const rows = [];
try {
  for (const job of jobs) {
    const key = `${job.key}-${job.precision}`;
    const manifestBytes = await readFile(resolve(root, job.manifest));
    const manifest = JSON.parse(manifestBytes);
    const variant = manifest.variants.find((v) => v.id === job.precision);
    assert(variant);
    const bytes = await readFile(routes.get(`/model/${key}.onnx`));
    assert.equal(bytes.length, job.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), job.sha256);
    assert.equal(variant.sha256, job.sha256);
    const artifacts = {
      model: { bytes: job.bytes, sha256: job.sha256 },
      manifest: {
        path: job.manifest,
        sha256: createHash("sha256").update(manifestBytes).digest("hex")
      }
    };
    for (const backend of ["wasm", "webgpu"]) {
      let reference;
      for (const executionMode of ["main", "worker"]) {
        const page = await browser.newPage();
        await page.goto(origin);
        const row = await page.evaluate(
          async ({ manifest, variant, key, backend, executionMode, origin }) => {
            let adapterIdentity = null;
            if (backend === "webgpu") {
              const adapter = await navigator.gpu.requestAdapter({
                powerPreference: "high-performance"
              });
              if (!adapter) throw new Error("没有可用的 WebGPU 适配器");
              const info = adapter.info ?? {};
              adapterIdentity = {
                architecture: info.architecture || null,
                description: info.description || null,
                device: info.device || null,
                isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? null,
                subgroupMaxSize: info.subgroupMaxSize ?? null,
                subgroupMinSize: info.subgroupMinSize ?? null,
                vendor: info.vendor || null
              };
            }
            const blob = await (await fetch("/samples/people.jpg")).blob();
            const data = await (await fetch(`/model/${key}.onnx`)).arrayBuffer();
            const detector = await PPDetection.createPPDetection({
              model: { data, manifest },
              backend,
              executionMode,
              precision: variant.precision,
              allowExperimental: manifest.status === "labs",
              allowFallback: false,
              cache: false,
              ort: { wasm: { paths: `${origin}/ort/`, numThreads: 1 } }
            });
            const result = await detector.detect(blob, { threshold: 0.5 });
            const controller = new AbortController();
            controller.abort();
            let abortCode;
            try {
              await detector.detect(blob, { signal: controller.signal });
            } catch (error) {
              abortCode = error.code;
            }
            const recovered = await detector.detect(blob, { threshold: 0.5 });
            await detector.dispose();
            let disposedCode;
            try {
              await detector.detect(blob);
            } catch (error) {
              disposedCode = error.code;
            }
            return {
              key,
              backend,
              executionMode,
              adapterIdentity,
              runtime: result.runtime,
              model: result.model,
              detections: result.detections,
              recovered: recovered.detections,
              abortCode,
              disposedCode,
              timings: result.timings,
              userAgent: navigator.userAgent
            };
          },
          { manifest, variant, key, backend, executionMode, origin }
        );
        if (backend === "webgpu")
          assert.ok(
            row.adapterIdentity.vendor === "nvidia" &&
              row.adapterIdentity.isFallbackAdapter === false,
            "需要物理 NVIDIA 适配器"
          );
        assert.equal(row.runtime.requestedBackend, backend);
        if (backend === "webgpu") assert.deepEqual(row.adapterIdentity, lock.gpuAdapter);
        assert.equal(row.model.variantId, job.precision);
        assert.equal(row.runtime.backend, backend);
        assert.equal(row.runtime.mode, executionMode);
        assert.equal(row.runtime.precision, variant.precision);
        assert.equal(row.runtime.fallbacks.length, 0);
        assert.equal(row.model.id, manifest.model.id);
        assert.equal(row.model.bytes, variant.bytes);
        assert.equal(row.abortCode, "ABORTED");
        assert.equal(row.disposedCode, "DISPOSED");
        assert.ok(row.detections.length > 0);
        assert.deepEqual(row.detections, row.recovered);
        if (reference) assert.deepEqual(row.detections, reference);
        else reference = row.detections;
        rows.push({ ...row, artifacts, status: "passed" });
        console.log(key, backend, executionMode, row.detections.length, "passed");
        await page.close();
      }
    }
  }
  assert.equal(rows.length, jobs.length * 4);
  await writeFile(
    resolve(report, outName),
    JSON.stringify(
      {
        protocolSha256: lock.protocolSha256,
        jobsSha256: createHash("sha256")
          .update(await readFile(jobPath))
          .digest("hex"),
        capturedAt: new Date().toISOString(),
        scope:
          "本轮达标精度候选 × 两后端 × main/worker；预取消、恢复检测和 dispose，不覆盖全部进行中取消竞态",
        sdkSha256: createHash("sha256")
          .update(await readFile(resolve(root, "packages/sdk/dist/browser-global.js")))
          .digest("hex"),
        browser: browser.version(),
        os: os.release(),
        cpu: os.cpus()[0].model,
        sample: {
          name: "people.jpg",
          sha256: createHash("sha256")
            .update(await readFile(routes.get("/samples/people.jpg")))
            .digest("hex")
        },
        rows
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
