// 在真实ORT调用前旁路保存输入张量，推理仍调用原session.run；不用于计时。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const [workArg, imageArg] = process.argv.slice(2);
assert(workArg && imageArg, "参数：工作目录 图片目录");
const work = resolve(workArg);
await mkdir(resolve(work, "inputs"), { recursive: true });
const manifest = JSON.parse(await readFile(resolve(work, "candidate-manifest.json"), "utf8"));
const dataset = JSON.parse(
  await readFile(
    resolve(root, "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json"),
    "utf8"
  )
);
const routes = new Map([["/model.onnx", resolve(work, "ppyolo-tiny-320-fp32.onnx")]]);
for (const [prefix, relative] of [
  ["/dist/", "packages/sdk/dist"],
  ["/ort/", "packages/sdk/node_modules/onnxruntime-web/dist"]
]) {
  for (const name of await readdir(resolve(root, relative)))
    routes.set(prefix + name, resolve(root, relative, name));
}
for (const item of dataset.images)
  routes.set("/images/" + item.file_name, resolve(imageArg, item.file_name));
const expectedIds = new Set(dataset.images.map((item) => item.id));
const inputs = [];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.method === "POST" && req.url.startsWith("/input/")) {
    const id = Number(req.url.slice("/input/".length));
    assert(expectedIds.has(id));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, 3 * 320 * 320 * 4);
    await writeFile(resolve(work, `inputs/${id}.f32`), bytes);
    inputs.push({ imageId: id, bytes: bytes.length, sha256: sha(bytes) });
    res.writeHead(200).end();
    return;
  }
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><script src="/dist/browser-global.js"></script>');
    return;
  }
  const path = routes.get(req.url);
  if (!path) return res.writeHead(404).end();
  res.writeHead(200, {
    "Content-Type":
      {
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".jpg": "image/jpeg"
      }[extname(path)] ?? "application/octet-stream",
    "Content-Length": (await stat(path)).size
  });
  createReadStream(path).pipe(res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const predictions = await page.evaluate(
    async ({ origin, manifest, dataset }) => {
      const ort = await import("/ort/ort.wasm.min.mjs");
      ort.env.wasm.wasmPaths = `${origin}/ort/`;
      ort.env.wasm.numThreads = 1;
      let imageId;
      const create = ort.InferenceSession.create.bind(ort.InferenceSession);
      ort.InferenceSession.create = async (...args) => {
        const session = await create(...args);
        const run = session.run.bind(session);
        session.run = async (feeds, ...rest) => {
          const data = feeds.image.data;
          const response = await fetch(`/input/${imageId}`, { method: "POST", body: data });
          if (!response.ok) throw new Error("输入保存失败");
          return run(feeds, ...rest);
        };
        return session;
      };
      const data = await (await fetch("/model.onnx")).arrayBuffer();
      const detector = await PPDetection.createPPDetection({
        model: { data, manifest },
        backend: "wasm",
        executionMode: "main",
        precision: "fp32",
        allowExperimental: true,
        allowFallback: false,
        cache: false,
        ort: { module: ort, wasm: { numThreads: 1, paths: `${origin}/ort/` } }
      });
      const categories = dataset.categories.slice().sort((a, b) => a.id - b.id);
      const predictions = [];
      for (const image of dataset.images) {
        imageId = image.id;
        const blob = await (await fetch("/images/" + image.file_name)).blob();
        const result = await detector.detect(blob, { threshold: 0.001 });
        for (const detection of result.detections)
          predictions.push({
            image_id: image.id,
            category_id: categories[detection.classId].id,
            score: detection.score,
            bbox: [detection.box.x, detection.box.y, detection.box.width, detection.box.height]
          });
      }
      await detector.dispose();
      return predictions;
    },
    { origin, manifest, dataset }
  );
  const reference = JSON.parse(await readFile(resolve(work, "round-1/tiny-wasm.json"), "utf8"));
  assert.deepEqual(predictions, reference.predictions, "旁路记录不得改变结果");
  assert.equal(inputs.length, 64);
  assert.equal(new Set(inputs.map((item) => item.imageId)).size, 64);
  await writeFile(
    resolve(work, "captured-inputs.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        sdkSha256: sha(await readFile(resolve(root, "packages/sdk/dist/browser-global.js"))),
        modelSha256: sha(await readFile(routes.get("/model.onnx"))),
        referencePredictionsUnchanged: true,
        dtype: "float32-le",
        shape: [1, 3, 320, 320],
        inputs
      },
      null,
      2
    ) + "\n"
  );
  console.log("64份实际输入已保存，旁路记录前后推理结果完全一致。");
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
