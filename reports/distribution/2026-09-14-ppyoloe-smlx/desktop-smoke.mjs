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
const models = {
  s: ".tmp/phase2/ppyoloe-plus-s-candidate.onnx",
  m: ".tmp/ppyoloe-plus-m-fixed.onnx",
  l: ".tmp/smlx-l/ppyoloe-plus-l-fixed.onnx",
  x: ".tmp/ppyoloe-plus-x-fixed.onnx"
};
for (const [key, path] of Object.entries(models))
  routes.set(`/model/${key}.onnx`, resolve(root, path));
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
  for (const key of Object.keys(models)) {
    const version = key === "s" ? "0.1.1" : "0.1.0";
    const manifest = JSON.parse(
      await readFile(
        resolve(root, `models/ppyoloe-plus-${key}-640/${version}/manifest.json`),
        "utf8"
      )
    );
    const bytes = await readFile(routes.get(`/model/${key}.onnx`));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.variants[0].sha256);
    for (const backend of ["wasm", "webgpu"]) {
      let reference;
      for (const executionMode of ["main", "worker"]) {
        const page = await browser.newPage();
        await page.goto(origin);
        const row = await page.evaluate(
          async ({ manifest, key, backend, executionMode, origin }) => {
            const blob = await (await fetch("/samples/people.jpg")).blob();
            const data = await (await fetch(`/model/${key}.onnx`)).arrayBuffer();
            const detector = await PPDetection.createPPDetection({
              model: { data, manifest },
              backend,
              executionMode,
              precision: "fp32",
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
          { manifest, key, backend, executionMode, origin }
        );
        assert.equal(row.runtime.backend, backend);
        assert.equal(row.runtime.mode, executionMode);
        assert.equal(row.runtime.fallbacks.length, 0);
        assert.equal(row.model.id, manifest.model.id);
        assert.equal(row.model.bytes, manifest.variants[0].bytes);
        assert.equal(row.abortCode, "ABORTED");
        assert.equal(row.disposedCode, "DISPOSED");
        assert.ok(row.detections.length > 0);
        assert.deepEqual(row.detections, row.recovered);
        if (reference) assert.deepEqual(row.detections, reference);
        else reference = row.detections;
        rows.push({ ...row, status: "passed" });
        console.log(key, backend, executionMode, row.detections.length, "passed");
        await page.close();
      }
    }
  }
  await writeFile(
    resolve(report, "desktop-smoke.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
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
