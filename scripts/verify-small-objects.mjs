// 使用已有实验输入复核产品实现；仅本地读取模型，不下载或发布资产。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];
if (!inputPath) throw new Error("参数：既有 tiling-refinement/inputs.json 的本地路径 [输出目录]");
const out = resolve(process.argv[3] ?? join(root, ".tmp/small-objects-verification"));
await mkdir(out, { recursive: true });
const inputs = JSON.parse(await readFile(inputPath, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsup"))("esbuild");
await mkdir(join(root, ".tmp"), { recursive: true });
const helper = join(root, ".tmp/small-objects-helper.mjs");
await build({
  entryPoints: [join(root, "packages/sdk/src/detection/small-objects.ts")],
  outfile: helper,
  bundle: true,
  format: "esm",
  platform: "node"
});
const { mergeSmallObjectDetections, projectTileDetection } = await import(
  pathToFileURL(helper).href
);
const simple = (d) => ({
  classId: d.classId,
  score: d.score,
  box: { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height }
});
const archived = [];
for (const name of await readdir(join(dirname(inputPath), "browser"))) {
  if (!name.endsWith(".json.gz") || name.includes("sanity")) continue;
  const bytes = await readFile(join(dirname(inputPath), "browser", name));
  const value = JSON.parse(gunzipSync(bytes));
  for (const image of value.images) {
    const actual = mergeSmallObjectDetections(
      image.whole,
      image.tiles.map((t) => ({
        tile: t.tile,
        detections: t.detections.map((d) => projectTileDetection(d, t.tile))
      })),
      image.width,
      image.height
    );
    assert.deepEqual(
      actual.map(simple),
      image.refined.map(simple),
      `${name}/${image.imageId} 合并不一致`
    );
  }
  archived.push({ name, sha256: sha(bytes), images: value.images.length });
}
const image = inputs.images[0];
const imagePath = join(inputs.imageRoot, image.file_name);
assert.equal(sha(await readFile(imagePath)), image.sha256);
for (const model of inputs.models) {
  assert.equal(sha(await readFile(model.path)), model.sha256);
  assert.equal(sha(await readFile(model.manifest)), model.manifestSha256);
}
const experimentRoot = join(root, "reports/evaluation/2026-09-12-tiling-refinement/reproduction");
const routes = new Map([
  ["/sample.jpg", imagePath],
  ["/tiling.mjs", join(experimentRoot, "tiling.mjs")],
  ["/merge.mjs", join(experimentRoot, "merge.mjs")],
  ["/2026-09-12-tiling/reproduction/tiling.mjs", join(experimentRoot, "tiling.mjs")]
]);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><script src="/dist/browser-global.js"></script>');
      return;
    }
    const file =
      routes.get(path) ??
      (path.startsWith("/dist/")
        ? join(root, "packages/sdk/dist", basename(path))
        : path.startsWith("/ort/")
          ? join(root, "packages/sdk/node_modules/onnxruntime-web/dist", basename(path))
          : undefined);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    const types = {
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".wasm": "application/wasm",
      ".jpg": "image/jpeg"
    };
    response.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "content-length": (await stat(file)).size
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium", headless: true });
const report = {
  startedAt: new Date().toISOString(),
  browser: browser.version(),
  bundleSha256: sha(await readFile(join(root, "packages/sdk/dist/browser-global.js"))),
  workerSha256: sha(await readFile(join(root, "packages/sdk/dist/inference.worker.js"))),
  archived,
  image,
  results: []
};
try {
  for (const model of inputs.models)
    for (const backend of ["wasm", "webgpu"])
      for (const mode of ["main", "worker"]) {
        routes.set("/model.onnx", model.path);
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto(origin);
        const manifest = JSON.parse(await readFile(model.manifest, "utf8"));
        const result = await page.evaluate(
          async ({ manifest, backend, mode, precision, origin }) => {
            const adapter = await navigator.gpu?.requestAdapter({
              powerPreference: "high-performance"
            });
            const adapterInfo = adapter
              ? {
                  vendor: adapter.info.vendor,
                  architecture: adapter.info.architecture,
                  isFallbackAdapter:
                    adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null
                }
              : null;
            if (
              backend === "webgpu" &&
              (!adapterInfo?.vendor || adapterInfo.isFallbackAdapter !== false)
            )
              throw Error("没有通过物理 GPU 检查");
            const detector = await PPDetection.createPPDetection({
              model: { data: await (await fetch("/model.onnx")).arrayBuffer(), manifest },
              backend,
              precision,
              executionMode: mode,
              allowFallback: false,
              cache: false,
              ort: { wasm: { paths: origin + "/ort/", numThreads: 1 } }
            });
            try {
              const blob = await (await fetch("/sample.jpg")).blob();
              const bitmap = await createImageBitmap(blob);
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
              const ctx = canvas.getContext("2d");
              ctx.drawImage(bitmap, 0, 0);
              bitmap.close();
              const image = {
                width: canvas.width,
                height: canvas.height,
                rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data
              };
              const progress = [];
              const enhanced = await detector.detect(blob, {
                threshold: 0.5,
                smallObjectEnhancement: true,
                onProgress: (event) => progress.push(event.completed)
              });
              const tiling = await import("/tiling.mjs");
              const { refine } = await import("/merge.mjs");
              const whole = await detector.detect(image, { threshold: 0.001 });
              const tiles = [];
              for (const tile of tiling.tileGrid(image.width, image.height)) {
                const detected = await detector.detect(tiling.cropRaster(image, tile), {
                  threshold: 0.001
                });
                tiles.push({
                  tile,
                  projected: detected.detections
                    .map((d) => tiling.projectDetection(d, tile))
                    .filter(Boolean)
                });
              }
              const reference = refine(
                { ...image, whole: whole.detections, tiles },
                "confident-anchor"
              ).detections.filter((d) => d.score >= 0.5);
              if (
                JSON.stringify(
                  enhanced.detections.map((d) => ({
                    classId: d.classId,
                    score: d.score,
                    box: { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height }
                  }))
                ) !==
                JSON.stringify(
                  reference.map((d) => ({
                    classId: d.classId,
                    score: d.score,
                    box: { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height }
                  }))
                )
              )
                throw Error("产品流程与冻结实验算法结果不一致");
              return {
                count: enhanced.detections.length,
                progress,
                enhancement: enhanced.smallObjectEnhancement,
                runtime: enhanced.runtime,
                timings: enhanced.timings,
                loadTimings: detector.loadTimings,
                adapter: adapterInfo,
                parity: true
              };
            } finally {
              await detector.dispose();
            }
          },
          { manifest, backend, mode, precision: model.precision, origin }
        );
        assert.deepEqual(result.progress, [0, 1, 2, 3, 4, 5]);
        assert.equal(result.runtime.backend, backend);
        assert.equal(result.runtime.mode, mode);
        assert.deepEqual(result.runtime.fallbacks, []);
        assert.deepEqual(errors, []);
        report.results.push({
          name: model.name,
          variant: model.variant,
          modelSha256: model.sha256,
          ...result
        });
        await writeFile(join(out, "real-models.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(
          `${model.name}/${model.variant}/${backend}/${mode}：${result.count} 框，逐框一致`
        );
        await page.close();
      }
  report.completedAt = new Date().toISOString();
  report.status = "passed";
  await writeFile(join(out, "real-models.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
