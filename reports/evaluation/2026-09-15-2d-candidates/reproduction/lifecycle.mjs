// 真实模型的main/Worker、预取消、恢复与释放核验；不覆盖进行中取消竞态。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
import { classifyAdapter } from "../../../../tools/model-pipeline/browser/evaluation-runner.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const [workArg, imageArg] = process.argv.slice(2);
assert(workArg && imageArg, "参数：工作目录 图片目录");
const work = resolve(workArg);
const manifestBytes = await readFile(resolve(work, "candidate-manifest.json"));
const manifest = JSON.parse(manifestBytes);
const annotationBytes = await readFile(
  resolve(root, "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json")
);
const annotations = JSON.parse(annotationBytes);
const subset = annotations.images.slice(0, 2);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const modelPath = resolve(work, "ppyolo-tiny-320-fp32.onnx");
assert.equal(sha(await readFile(modelPath)), manifest.variants[0].sources[0].sha256);
const routes = new Map([["/model.onnx", modelPath]]);
for (const [prefix, relative] of [
  ["/dist/", "packages/sdk/dist"],
  ["/ort/", "packages/sdk/node_modules/onnxruntime-web/dist"]
]) {
  for (const name of await readdir(resolve(root, relative)))
    routes.set(prefix + name, resolve(root, relative, name));
}
const imageEvidence = [];
for (const image of subset) {
  const path = resolve(imageArg, image.file_name);
  routes.set("/images/" + image.file_name, path);
  imageEvidence.push({
    imageId: image.id,
    fileName: image.file_name,
    sha256: sha(await readFile(path))
  });
}
const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Tiny生命周期核验</title><script src="/dist/browser-global.js"></script></html>'
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
const rows = [];
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  for (const backend of ["wasm", "webgpu"]) {
    let reference;
    for (const executionMode of ["main", "worker"]) {
      const page = await browser.newPage();
      await page.goto(origin);
      const row = await page.evaluate(
        async ({ backend, executionMode, manifest, subset, origin }) => {
          const adapter = backend === "webgpu" ? await navigator.gpu.requestAdapter() : null;
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
          const data = await (await fetch("/model.onnx")).arrayBuffer();
          const detector = await PPDetection.createPPDetection({
            model: { data, manifest },
            backend,
            executionMode,
            precision: "fp32",
            allowExperimental: true,
            allowFallback: false,
            cache: false,
            ort: { wasm: { paths: `${origin}/ort/`, numThreads: 1 } }
          });
          const results = [];
          let blob;
          for (const item of subset) {
            blob = await (await fetch("/images/" + item.file_name)).blob();
            const result = await detector.detect(blob, { threshold: 0.5 });
            results.push({
              imageId: item.id,
              detections: result.detections,
              runtime: result.runtime
            });
          }
          const aborter = new AbortController();
          aborter.abort();
          let abortCode;
          try {
            await detector.detect(blob, { signal: aborter.signal });
          } catch (e) {
            abortCode = e.code;
          }
          const recovered = await detector.detect(blob, { threshold: 0.5 });
          await detector.dispose();
          await detector.dispose();
          let disposedCode;
          try {
            await detector.detect(blob);
          } catch (e) {
            disposedCode = e.code;
          }
          return {
            backend,
            executionMode,
            adapterIdentity,
            results,
            recovered: recovered.detections,
            abortCode,
            disposedCode
          };
        },
        { backend, executionMode, manifest, subset, origin }
      );
      assert.equal(row.abortCode, "ABORTED");
      assert.equal(row.disposedCode, "DISPOSED");
      for (const result of row.results) {
        assert.equal(result.runtime.backend, backend);
        assert.equal(result.runtime.requestedBackend, backend);
        assert.equal(result.runtime.mode, executionMode);
        assert.equal(result.runtime.precision, "fp32");
        assert.deepEqual(result.runtime.fallbacks, []);
      }
      if (backend === "webgpu") assert(classifyAdapter(row.adapterIdentity).physical);
      const detections = row.results.map((result) => result.detections);
      assert(detections.flat().length > 0);
      assert.deepEqual(row.recovered, detections.at(-1));
      if (reference) assert.deepEqual(detections, reference);
      else reference = detections;
      rows.push({ ...row, status: "passed" });
      console.log(backend, executionMode, "通过");
      await page.close();
    }
  }
  await writeFile(
    resolve(work, "lifecycle.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        scope: "两后端×main/Worker，两图识别、预取消、恢复、释放和重复释放；不覆盖进行中取消竞态",
        browser: browser.version(),
        os: os.release(),
        cpu: os.cpus()[0].model,
        sdkSha256: sha(await readFile(resolve(root, "packages/sdk/dist/browser-global.js"))),
        workerSha256: sha(await readFile(resolve(root, "packages/sdk/dist/inference.worker.js"))),
        modelSha256: sha(await readFile(modelPath)),
        manifestSha256: sha(manifestBytes),
        images: imageEvidence,
        rows
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
