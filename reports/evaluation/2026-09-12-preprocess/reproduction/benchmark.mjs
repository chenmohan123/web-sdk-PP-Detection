// 固定 JPEG、相同像素和同一浏览器交替测量，比较 Float32 位模式。
import { createServer } from "node:http";
import { readFileSync, writeFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { chromium } from "playwright";
const dir = process.argv[2] ?? ".tmp/preprocess-micro";
const imageRoot = process.argv[3] ?? ".tmp/phase2/dataset/images";
const annotations = "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json";
const dataset = JSON.parse(readFileSync(annotations, "utf8"));
const routes = new Map([
  ["/baseline.mjs", join(dir, "baseline.mjs")],
  ["/candidate.mjs", join(dir, "candidate.mjs")]
]);
for (const im of dataset.images)
  routes.set("/images/" + im.file_name, join(imageRoot, im.file_name));
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><meta charset="utf-8"><title>预处理对照</title>');
    return;
  }
  const path = routes.get(url.pathname);
  if (!path) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("content-type", path.endsWith(".mjs") ? "text/javascript" : "image/jpeg");
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "log") console.log(msg.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(
    async ({ images, configs }) => {
      const baseline = (await import("/baseline.mjs")).preprocessImage;
      const candidate = (await import("/candidate.mjs")).preprocessImage;
      const rounds = [];
      let compared = 0;
      for (let round = 0; round < 3; round++) {
        const values = [];
        for (const [index, im] of images.entries()) {
          const bitmap = await createImageBitmap(
            await (await fetch("/images/" + im.file_name)).blob()
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(bitmap, 0, 0);
          const raster = {
            width: bitmap.width,
            height: bitmap.height,
            rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
          };
          bitmap.close();
          for (const [model, config] of Object.entries(configs)) {
            if (index === 0 && round === 0)
              for (let warm = 0; warm < 5; warm++) {
                baseline(raster, config);
                candidate(raster, config);
              }
            const outputs = {},
              timings = {};
            for (const name of (index + round) % 2 === 0
              ? ["baseline", "candidate"]
              : ["candidate", "baseline"]) {
              const started = performance.now();
              outputs[name] = (name === "baseline" ? baseline : candidate)(raster, config);
              timings[name] = performance.now() - started;
            }
            if (round === 0) {
              const left = new Uint32Array(outputs.baseline.data.buffer),
                right = new Uint32Array(outputs.candidate.data.buffer);
              if (left.length !== right.length) throw new Error("张量尺寸变化");
              for (let i = 0; i < left.length; i++)
                if (left[i] !== right[i])
                  throw new Error(`像素不一致 ${model} ${im.id} ${i}: ${left[i]} / ${right[i]}`);
              if (
                JSON.stringify(outputs.baseline.transform) !==
                JSON.stringify(outputs.candidate.transform)
              )
                throw new Error("坐标变换变化");
              compared++;
            }
            values.push({ imageId: im.id, model, ...timings });
          }
        }
        rounds.push(values);
        console.log("预处理对照轮次 " + (round + 1) + "/3");
      }
      return { userAgent: navigator.userAgent, compared, rounds };
    },
    {
      images: dataset.images,
      configs: {
        picodet: JSON.parse(readFileSync("models/pp-detection/manifest.json", "utf8"))
          .preprocessing,
        ppyoloe: JSON.parse(readFileSync("models/ppyoloe-plus-s-640/manifest.json", "utf8"))
          .preprocessing
      }
    }
  );
  const median = (values) => {
    const s = values.toSorted((a, b) => a - b);
    return (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2;
  };
  const summary = {};
  for (const model of ["picodet", "ppyoloe"]) {
    const rounds = result.rounds.map((r) => ({
      baseline: median(r.filter((v) => v.model === model).map((v) => v.baseline)),
      candidate: median(r.filter((v) => v.model === model).map((v) => v.candidate))
    }));
    const baseline = median(rounds.map((r) => r.baseline)),
      candidate = median(rounds.map((r) => r.candidate));
    summary[model] = {
      rounds,
      baselineMedianMs: baseline,
      candidateMedianMs: candidate,
      reductionPercent: (1 - candidate / baseline) * 100
    };
  }
  const evidence = {
    capturedAt: new Date().toISOString(),
    scope: "预处理微基准，不含解码、会话或推理；同图输入两版各三轮",
    cpu: os.cpus()[0].model,
    os: os.release(),
    browser: browser.version(),
    sourceHashes: Object.fromEntries(
      ["baseline", "candidate"].map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(join(dir, name + ".mjs")))
          .digest("hex")
      ])
    ),
    annotationsSha256: createHash("sha256").update(readFileSync(annotations)).digest("hex"),
    ...result,
    summary,
    performanceTargetMet: summary.ppyoloe.reductionPercent >= 20
  };
  writeFileSync(
    join(dir, process.argv[4] ?? "microbenchmark.json"),
    JSON.stringify(evidence, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      summary,
      compared: result.compared,
      performanceTargetMet: evidence.performanceTargetMet
    })
  );
  process.exitCode = evidence.performanceTargetMet ? 0 : 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
