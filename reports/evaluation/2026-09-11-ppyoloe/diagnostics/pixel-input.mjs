import { createServer } from "node:http";
import { readFileSync, writeFileSync, createReadStream, statSync, existsSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const repo = process.cwd();
const root = resolve(".tmp/phase2");
const backend = process.argv[2] ?? "wasm";
const kind = process.argv[3] ?? "ppyoloe";
const raster = process.argv.includes("--raster");
const modelPath =
  kind === "picodet"
    ? resolve("models/pp-detection/picodet-l-320-fp32.onnx")
    : join(root, "ppyoloe-plus-s-candidate.onnx");
const sha = createHash("sha256").update(readFileSync(modelPath)).digest("hex");
const dataset = JSON.parse(readFileSync(join(root, "dataset/annotations.json"), "utf8"));
const manifest = JSON.parse(readFileSync("models/pp-detection/manifest.json", "utf8"));
manifest.postprocessing.scoreThreshold = 0.001;
manifest.postprocessing.iouThreshold = 1;
if (kind === "ppyoloe") {
  manifest.model = { id: "pp-yoloe-plus-s-640", version: "0.0.0-candidate" };
  manifest.input.shape = [1, 3, 640, 640];
  manifest.outputs = [
    { name: "save_infer_model/scale_0.tmp_0", shape: [-1, 6], dtype: "float32" },
    { name: "save_infer_model/scale_1.tmp_0", shape: [1], dtype: "int32" }
  ];
  Object.assign(manifest.preprocessing, {
    size: { width: 640, height: 640 },
    mean: [0, 0, 0],
    std: [1, 1, 1]
  });
}
const bytes = statSync(modelPath).size;
manifest.variants = [
  {
    id: "fp32",
    precision: "fp32",
    quantization: null,
    opset: 11,
    bytes,
    parameterCount: null,
    backends: ["wasm", "webgpu"],
    status: "labs",
    sources: [
      {
        kind: "custom",
        repository: "local://evaluation",
        revision: sha,
        path: basename(modelPath),
        downloadUrl: "http://localhost/model.onnx",
        bytes,
        sha256: sha
      }
    ]
  }
];
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><meta charset="utf-8"><script></script><script src="/dist/browser-global.js"></script>'
    );
    return;
  }
  const asset =
    path === "/model.onnx"
      ? modelPath
      : path.startsWith("/dist/")
        ? join(repo, "packages/sdk/dist", basename(path))
        : path.startsWith("/ort/")
          ? join(repo, "packages/sdk/node_modules/onnxruntime-web/dist", basename(path))
          : path.startsWith("/images/")
            ? join(root, "dataset/images", basename(path))
            : path.startsWith("/rgba/")
              ? join(root, "dataset/rgba", basename(path))
              : null;
  if (!asset || !existsSync(asset)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "content-type",
    {
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".wasm": "application/wasm",
      ".jpg": "image/jpeg"
    }[extname(asset)] ?? "application/octet-stream"
  );
  createReadStream(asset).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
manifest.variants[0].sources[0].downloadUrl = origin + "/model.onnx";
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "log") console.log(msg.text());
  });
  page.on("pageerror", (error) => console.log("pageerror", String(error)));
  await page.goto(origin);
  const result = await page.evaluate(
    async ({ backend, manifest, dataset, origin, raster }) => {
      let adapterInfo = null;
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        const info = adapter.info;
        adapterInfo = {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter
        };
      }
      if (backend === "webgpu" && !adapter) return { status: "unsupported", adapterInfo };
      const detector = await window.PPDetection.createPPDetection({
        allowExperimental: true,
        executionMode: "main",
        allowFallback: false,
        backend,
        cache: false,
        model: { data: await (await fetch("/model.onnx")).arrayBuffer(), manifest },
        ort: { wasm: { numThreads: 1, paths: origin + "/ort/" } },
        precision: "fp32"
      });
      try {
        const predictions = [],
          images = [];
        const categoryIds = dataset.categories.map((x) => x.id).sort((a, b) => a - b);
        for (const [index, image] of dataset.images.entries()) {
          const input = raster
            ? {
                width: image.width,
                height: image.height,
                rgba: new Uint8ClampedArray(
                  await (await fetch("/rgba/" + image.file_name + ".rgba")).arrayBuffer()
                )
              }
            : await (await fetch("/images/" + image.file_name)).blob();
          const result = await detector.detect(input, { threshold: 0.001 });
          for (const x of result.detections)
            predictions.push({
              image_id: image.id,
              category_id: categoryIds[x.classId],
              bbox: [x.box.x, x.box.y, x.box.width, x.box.height],
              score: x.score
            });
          images.push({
            imageId: image.id,
            timings: result.timings,
            count: result.detections.length
          });
          if ((index + 1) % 16 === 0) console.log(`${backend}: ${index + 1}/64`);
        }
        return {
          status: "passed",
          capturedAt: new Date().toISOString(),
          adapterInfo,
          browser: {
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            crossOriginIsolated
          },
          runtime: detector.runtime,
          loadTimings: detector.loadTimings,
          model: detector.model,
          images,
          predictions
        };
      } finally {
        await detector.dispose();
      }
    },
    { backend, manifest, dataset, origin, raster }
  );
  writeFileSync(
    join(root, `results/browser-${kind}-${backend}${raster ? "-raster" : ""}.json`),
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      status: result.status,
      adapterInfo: result.adapterInfo,
      runtime: result.runtime,
      loadTimings: result.loadTimings
    })
  );
} catch (error) {
  writeFileSync(
    join(root, `results/browser-${kind}-${backend}-error.json`),
    JSON.stringify({ error: String(error), stack: error.stack }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
