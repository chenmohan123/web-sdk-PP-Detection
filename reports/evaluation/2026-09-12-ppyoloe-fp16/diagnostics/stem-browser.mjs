// 直接调用 ORT，以全零/全一输入定位 FP16 数值错误，不经过 SDK 预处理。
import { createServer } from "node:http";
import { readFileSync, createReadStream, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";
const dir = ".tmp/fp16-2026-09-12";
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><meta charset="utf-8"><title>数值诊断</title>');
    return;
  }
  const file = url.pathname.startsWith("/ort/")
    ? join("packages/sdk/node_modules/onnxruntime-web/dist", basename(url.pathname))
    : join(dir, basename(url.pathname));
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "content-type",
    file.endsWith(".mjs")
      ? "text/javascript"
      : file.endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream"
  );
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  const results = await page.evaluate(
    async ({ origin, names }) => {
      const ort = await import("/ort/ort.webgpu.min.mjs");
      ort.env.wasm.wasmPaths = origin + "/ort/";
      ort.env.wasm.numThreads = 1;
      const adapter = await navigator.gpu.requestAdapter();
      ort.env.webgpu.adapter = adapter;
      const result = {
        runtime: ort.env.versions.web,
        browser: navigator.userAgent,
        adapter: { ...adapter.info, features: [...adapter.features] },
        models: {}
      };
      for (const name of names) {
        const model = await (await fetch("/" + name + ".onnx")).arrayBuffer();
        const session = await ort.InferenceSession.create(model, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all"
        });
        const rows = [];
        for (const fill of [0, 1]) {
          const output = await session.run({
            image: new ort.Tensor(
              "float32",
              new Float32Array(3 * 640 * 640).fill(fill),
              [1, 3, 640, 640]
            )
          });
          const values = {};
          for (const [key, t] of Object.entries(output)) {
            const d =
              t.type === "float16"
                ? new Float16Array(t.data.buffer, t.data.byteOffset, t.data.length)
                : t.data;
            let min = Infinity,
              max = -Infinity,
              sum = 0,
              nonfinite = 0;
            for (const value of d) {
              min = Math.min(min, value);
              max = Math.max(max, value);
              sum += value;
              if (!Number.isFinite(value)) nonfinite++;
            }
            values[key] = {
              min,
              max,
              mean: sum / d.length,
              nonfinite,
              sample: Array.from(d.slice(0, 16))
            };
            t.dispose();
          }
          rows.push({ fill, outputs: values });
        }
        await session.release();
        result.models[name] = rows;
      }
      return result;
    },
    {
      origin,
      names: process.argv.slice(2).length
        ? process.argv.slice(2)
        : ["stem-boundaries", "stem-fused"]
    }
  );
  writeFileSync(dir + "/stem-webgpu.json", JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
