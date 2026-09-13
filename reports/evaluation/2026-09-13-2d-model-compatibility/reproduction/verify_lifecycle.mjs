// 只读本地候选资产；使用真实 ORT 和 Worker，观察调用边界，不替换推理结果。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import {
  classifyAdapter,
  validateCategoryMapping
} from "../../../../tools/model-pipeline/browser/evaluation-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const [modelArgument, imagesArgument, outputArgument] = process.argv.slice(2);
assert.ok(modelArgument && imagesArgument && outputArgument, "参数：模型路径 图片目录 输出目录");
const modelPath = resolve(modelArgument);
const imageRoot = resolve(imagesArgument);
const output = resolve(outputArgument);
await mkdir(output, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = async (path) => {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: sha(bytes) };
};
const archive = async (name) =>
  JSON.parse(gunzipSync(await readFile(join(here, "../evidence", name + ".gz"))));
const manifest = await archive("candidate-manifest.json");
const annotations = await archive("browser-annotations.json");
const previous = await archive("browser-wasm.json");
const categoryIds = validateCategoryMapping(manifest.labels, annotations.categories);
const model = await evidence(modelPath);
assert.equal(model.sha256, "a8fb0978485d42f78346339490302e4f3116daa2cdc7c192b2e2250b1675cd2e");
assert.equal(model.bytes, 345644377);
const images = [];
for (const item of annotations.images) {
  assert.equal(basename(item.file_name), item.file_name);
  const actual = await evidence(join(imageRoot, item.file_name));
  assert.equal(actual.sha256, previous.images.find((i) => i.imageId === item.id)?.sha256);
  images.push({ imageId: item.id, fileName: item.file_name, ...actual });
}
assert.equal(images.length, 8);
const ortDirectory = join(root, "packages/sdk/node_modules/onnxruntime-web/dist");
const originalWorkerPath = join(root, "packages/sdk/dist/inference.worker.js");
const instrumentedWorkerPath = join(output, "inference.worker.instrumented.js");
const originalWorker = await readFile(originalWorkerPath, "utf8");
const workerNeedle = `const result = await session.run(request.input, {\n          signal: controller.signal\n        });`;
assert.equal(originalWorker.split(workerNeedle).length, 2, "Worker 运行边界未找到");
await writeFile(
  instrumentedWorkerPath,
  originalWorker.replace(
    workerNeedle,
    `const runPromise = session.run(request.input, {\n          signal: controller.signal\n        });\n        workerScope.postMessage({ id: "__sod_probe__", type: "sod-run-started" });\n        const result = await runPromise;`
  )
);
const routes = new Map([["/model.onnx", modelPath]]);
for (const name of ["browser-global.js", "inference.worker.js"])
  routes.set(`/dist/${name}`, join(root, "packages/sdk/dist", name));
routes.set("/dist/inference.worker.js", instrumentedWorkerPath);
for (const name of await readdir(ortDirectory))
  if (/\.(m?js|wasm)$/u.test(name)) routes.set(`/ort/${name}`, join(ortDirectory, name));
for (const item of images) routes.set(`/images/${item.fileName}`, join(imageRoot, item.fileName));
const requests = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  requests.push(path);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>SOD 生命周期核验</title><script src="/dist/browser-global.js"></script></html>'
    );
    return;
  }
  if (path.startsWith("/failure/")) return response.writeHead(503).end("本地故障注入");
  try {
    const file = routes.get(path);
    if (!file) return response.writeHead(404).end();
    response.writeHead(200, {
      "Content-Length": (await stat(file)).size,
      "Content-Type":
        {
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".wasm": "application/wasm",
          ".jpg": "image/jpeg"
        }[extname(file)] ?? "application/octet-stream"
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  model,
  images,
  sdk: await evidence(join(root, "packages/sdk/dist/browser-global.js")),
  worker: await evidence(join(root, "packages/sdk/dist/inference.worker.js")),
  instrumentedWorker: await evidence(instrumentedWorkerPath),
  runner: await evidence(fileURLToPath(import.meta.url)),
  environment: {
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    cpu: os.cpus()[0].model,
    logicalCores: os.cpus().length
  },
  policy: {
    scoreThreshold: 0.5,
    iouThreshold: 0.99,
    cache: false,
    allowFallback: false,
    wasmThreads: 1,
    smallObjectEnhancement: false
  },
  results: [],
  failures: []
};
report.diagnosticSelection = process.env.SOD_MATRIX ?? null;
report.trace = [];
let browser;
const save = () =>
  writeFile(join(output, "lifecycle.json"), JSON.stringify(report, null, 2) + "\n");
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  report.environment.browser = browser.version();
  for (const backend of ["wasm", "webgpu"])
    for (const mode of ["main", "worker"]) {
      if (report.diagnosticSelection && report.diagnosticSelection !== `${backend}/${mode}`)
        continue;
      console.log(`开始 ${backend}/${mode}`);
      const page = await browser.newPage();
      const deadline = setTimeout(() => {
        void page.close();
      }, 180000);
      page.on("close", () => clearTimeout(deadline));
      page.setDefaultTimeout(180000);
      const pageErrors = [],
        messages = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) messages.push(message.text());
        if (message.text().startsWith("[SOD]")) {
          console.log(message.text());
          report.trace.push({
            at: new Date().toISOString(),
            backend,
            mode,
            message: message.text()
          });
        }
      });
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
      );
      await page.goto(origin);
      const result = await page.evaluate(
        async ({ manifest, images, categoryIds, backend, mode, origin }) => {
          const check = (value, message) => {
            if (!value) throw Error(message);
          };
          const errorResult = async (operation) => {
            try {
              await operation();
              return { code: null };
            } catch (error) {
              return { code: error.code ?? null, message: error.message, details: error.details };
            }
          };
          const adapter = await navigator.gpu?.requestAdapter({
            powerPreference: "high-performance"
          });
          const adapterInfo = adapter
            ? {
                vendor: adapter.info.vendor,
                architecture: adapter.info.architecture,
                device: adapter.info.device,
                description: adapter.info.description,
                isFallbackAdapter:
                  adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null
              }
            : null;
          const metrics = { runs: 0, releases: 0, workersCreated: 0, workersTerminated: 0 };
          let onRun;
          // 观察真实 session.run 已调用且 Promise 尚未消费的边界，不承诺中断底层算子。
          const NativeWorker = window.Worker;
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              metrics.workersCreated++;
              this.addEventListener("message", ({ data }) => {
                if (data.type === "sod-run-started") {
                  metrics.runs++;
                  onRun?.();
                }
              });
            }
            terminate() {
              metrics.workersTerminated++;
              return super.terminate();
            }
          };
          const ort = await import(
            backend === "webgpu" ? "/ort/ort.webgpu.min.mjs" : "/ort/ort.wasm.min.mjs"
          );
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.wasmPaths = origin + "/ort/";
          if (backend === "webgpu") ort.env.webgpu.adapter = adapter;
          const observedOrt = {
            env: ort.env,
            Tensor: ort.Tensor,
            InferenceSession: {
              create: async (...args) => {
                const session = await ort.InferenceSession.create(...args);
                return {
                  run: (...feeds) => {
                    const pending = session.run(...feeds);
                    metrics.runs++;
                    queueMicrotask(() => onRun?.());
                    return pending;
                  },
                  release: async () => {
                    await session.release();
                    metrics.releases++;
                  }
                };
              }
            }
          };
          const bytes = await (await fetch("/model.onnx")).arrayBuffer();
          const phaseEvents = [];
          let onPhase;
          const createStart = performance.now();
          const detector = await PPDetection.createPPDetection({
            model: { data: bytes, manifest },
            allowExperimental: true,
            backend,
            executionMode: mode,
            precision: "fp32",
            allowFallback: false,
            source: "custom",
            cache: false,
            ort: {
              ...(mode === "main" ? { module: observedOrt } : {}),
              wasm: { paths: origin + "/ort/", numThreads: 1 }
            },
            onProgress: (event) => {
              phaseEvents.push({ phase: event.phase, status: event.status });
              console.log(`[SOD] ${backend}/${mode} ${event.phase}/${event.status}`);
              onPhase?.(event);
            }
          });
          const createWallMs = performance.now() - createStart;
          const results = [],
            predictions = [],
            blobs = [];
          const runtimeCheck = (result) => {
            check(
              result.runtime.backend === backend &&
                result.runtime.mode === mode &&
                result.runtime.precision === "fp32" &&
                result.runtime.fallbacks.length === 0,
              "发生非预期后端、精度或模式替换"
            );
            check(
              result.model.source.sha256 === manifest.variants[0].sources[0].sha256,
              "结果模型摘要不匹配"
            );
          };
          const run = async (blob, options = {}) => {
            const started = performance.now();
            const value = await detector.detect(blob, { threshold: 0.5, ...options });
            runtimeCheck(value);
            return { ...value, wallClockMs: performance.now() - started };
          };
          try {
            for (const image of images) {
              const blob = await (await fetch(`/images/${image.fileName}`)).blob();
              blobs.push(blob);
              const value = await run(blob);
              for (const d of value.detections)
                predictions.push({
                  image_id: image.imageId,
                  category_id: categoryIds[d.classId],
                  score: d.score,
                  bbox: [d.box.x, d.box.y, d.box.width, d.box.height]
                });
              results.push({
                imageId: image.imageId,
                count: value.detections.length,
                timings: value.timings,
                wallClockMs: value.wallClockMs
              });
            }
            const baseline = await run(blobs[0]);
            const same = (value) =>
              check(
                JSON.stringify(value.detections) === JSON.stringify(baseline.detections),
                "取消后复用的输出发生变化"
              );
            const lifecycle = {};
            let count = metrics.runs;
            const pre = new AbortController();
            pre.abort();
            lifecycle.preAborted = {
              ...(await errorResult(() => run(blobs[0], { signal: pre.signal }))),
              dispatchedRuns: metrics.runs - count
            };
            check(
              lifecycle.preAborted.code === "ABORTED" && metrics.runs === count,
              "运行前取消失败"
            );
            const boundary = new AbortController();
            onPhase = (event) => {
              if (event.phase === "inference" && event.status === "start") boundary.abort();
            };
            lifecycle.boundaryAbort = {
              ...(await errorResult(() => run(blobs[0], { signal: boundary.signal }))),
              dispatchedRuns: metrics.runs - count
            };
            onPhase = undefined;
            check(
              lifecycle.boundaryAbort.code === "ABORTED" && metrics.runs === count,
              "推理边界取消失败"
            );
            const active = new AbortController();
            let actionAt = null;
            onRun = () => {
              onRun = undefined;
              actionAt = performance.now();
              active.abort();
            };
            lifecycle.inflightAbort = await errorResult(() =>
              run(blobs[0], { signal: active.signal })
            );
            lifecycle.inflightAbort.responseMs =
              actionAt === null ? null : performance.now() - actionAt;
            check(
              actionAt !== null && lifecycle.inflightAbort.code === "ABORTED",
              "在途取消未返回 ABORTED"
            );
            const reused = await run(blobs[0]);
            same(reused);
            lifecycle.reuseAfterAbort = {
              parity: true,
              timings: reused.timings,
              wallClockMs: reused.wallClockMs
            };
            // 定时器代表 UI 消息循环能否响应，不用于把主线程同步 WASM 误判为即时可取消。
            let timer,
              firedAt = null,
              scheduledAt = null;
            onPhase = (event) => {
              if (event.phase === "inference" && event.status === "start") {
                scheduledAt = performance.now();
                timer = setTimeout(() => {
                  firedAt = performance.now();
                }, 20);
              }
            };
            const responsiveRun = await run(blobs[0]);
            const settledAt = performance.now();
            await new Promise((done) => setTimeout(done, 30));
            clearTimeout(timer);
            onPhase = undefined;
            check(firedAt !== null && scheduledAt !== null, "事件循环计时器没有实际触发");
            lifecycle.eventLoop = {
              requestedDelayMs: 20,
              observedDelayMs: firedAt - scheduledAt,
              firedBeforeResult: firedAt < settledAt,
              inferenceMs: responsiveRun.timings.inferenceMs
            };
            let disposal;
            actionAt = null;
            onRun = () => {
              onRun = undefined;
              actionAt = performance.now();
              disposal = detector.dispose();
            };
            const pending = errorResult(() => run(blobs[0]));
            const queued = errorResult(() => run(blobs[0]));
            lifecycle.disposeActive = await pending;
            lifecycle.disposeQueued = await queued;
            check(actionAt !== null, "没有在途释放触发点");
            await disposal;
            lifecycle.disposeActive.releaseMs = performance.now() - actionAt;
            check(
              lifecycle.disposeActive.code === "DISPOSED" &&
                lifecycle.disposeQueued.code === "DISPOSED",
              "释放未取消活动和排队请求"
            );
            await detector.dispose();
            await detector.dispose();
            lifecycle.detectAfterDispose = await errorResult(() => detector.detect(blobs[0]));
            lifecycle.loadAfterDispose = await errorResult(() => detector.load());
            check(
              lifecycle.detectAfterDispose.code === "DISPOSED" &&
                lifecycle.loadAfterDispose.code === "DISPOSED",
              "释放后错误不稳定"
            );
            check(
              mode === "main"
                ? metrics.releases === 1
                : metrics.workersCreated === 1 && metrics.workersTerminated === 1,
              "资源释放次数异常"
            );
            lifecycle.repeatedDispose = "passed";
            return {
              backend,
              mode,
              adapter: adapterInfo,
              createWallMs,
              loadTimings: detector.loadTimings,
              runtime: detector.runtime,
              sdkVersion: PPDetection.CURRENT_SDK_VERSION,
              ortVersion: detector.runtime.runtimeVersion,
              images: results,
              predictions,
              lifecycle,
              metrics,
              phaseEvents,
              environment: {
                userAgent: navigator.userAgent,
                crossOriginIsolated,
                hardwareConcurrency: navigator.hardwareConcurrency
              },
              status: "passed"
            };
          } finally {
            onRun = undefined;
            onPhase = undefined;
            await detector.dispose();
            window.Worker = NativeWorker;
          }
        },
        { manifest, images, categoryIds, backend, mode, origin }
      );
      assert.deepEqual(pageErrors, []);
      if (backend === "webgpu")
        assert.ok(classifyAdapter(result.adapter).physical, "未确认物理 GPU");
      report.results.push({ ...result, messages, pageErrors });
      await save();
      console.log(`${backend}/${mode}：8 图、取消、复用、释放通过`);
      await page.close();
    }
  // 同一后端要求 Worker 逐值一致；跨后端按固定误差门槛逐框校验。
  const baseline = report.results[0]?.predictions;
  for (const result of report.diagnosticSelection ? [] : report.results) {
    const main = report.results.find((r) => r.backend === result.backend && r.mode === "main");
    assert.deepEqual(result.predictions, main.predictions, "同后端主线程与 Worker 输出不一致");
    assert.equal(result.predictions.length, baseline.length);
    for (let i = 0; i < baseline.length; i++) {
      const a = baseline[i],
        b = result.predictions[i];
      assert.equal(a.image_id, b.image_id);
      assert.equal(a.category_id, b.category_id);
      assert.ok(Math.abs(a.score - b.score) <= 0.001, "跨后端分数偏差超限");
      assert.ok(
        a.bbox.every((v, j) => Math.abs(v - b.bbox[j]) <= 0.1),
        "跨后端坐标偏差超限"
      );
    }
  }
  report.crossModeParity = report.diagnosticSelection ? "not-run" : "passed";
  for (const mode of ["main", "worker"]) {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await page.goto(origin);
    const requestStart = requests.length;
    const failures = await page.evaluate(
      async ({ manifest, mode, origin }) => {
        const results = [];
        const checkFailure = async (name, options, expected) => {
          const events = [];
          let code = null,
            message = null;
          try {
            const detector = await PPDetection.createPPDetection({
              allowExperimental: true,
              allowFallback: true,
              backend: "wasm",
              precision: "fp32",
              executionMode: mode,
              cache: false,
              model: manifest,
              ort: { wasm: { paths: origin + "/ort/", numThreads: 1 } },
              ...options,
              onProgress: (event) => events.push({ phase: event.phase, status: event.status })
            });
            await detector.dispose();
          } catch (error) {
            code = error.code;
            message = error.message;
          }
          if (code !== expected || events.some((event) => event.phase === "fallback"))
            throw Error(`${name} 未按显式选择失败：${code}`);
          results.push({ name, expected, code, message, events, mode });
        };
        const sourceManifest = structuredClone(manifest);
        sourceManifest.variants[0].sources = ["modelscope", "huggingface"].map((kind) => ({
          ...manifest.variants[0].sources[0],
          kind,
          downloadUrl: `${origin}/failure/${mode}/${kind}`
        }));
        for (const source of ["modelscope", "huggingface"])
          await checkFailure(
            `显式来源 ${source} HTTP 503`,
            { model: sourceManifest, source, download: { maxRetries: 0 } },
            "MODEL_SOURCE_UNAVAILABLE"
          );
        await checkFailure("不存在的 FP16 变体", { precision: "fp16" }, "MODEL_INCOMPATIBLE");
        const limited = structuredClone(manifest);
        limited.variants[0].backends = ["wasm"];
        await checkFailure(
          "变体不支持显式 WebGPU",
          { model: limited, backend: "webgpu" },
          "CAPABILITY_UNSUPPORTED"
        );
        await checkFailure("未允许实验模型", { allowExperimental: false }, "MODEL_INCOMPATIBLE");
        return results;
      },
      { manifest, mode, origin }
    );
    const actualRequests = requests.slice(requestStart);
    assert.equal(actualRequests.filter((path) => path === `/failure/${mode}/modelscope`).length, 1);
    assert.equal(
      actualRequests.filter((path) => path === `/failure/${mode}/huggingface`).length,
      1
    );
    assert.equal(actualRequests.filter((path) => path === "/model.onnx").length, 0);
    report.failures.push({ mode, results: failures, requests: actualRequests });
    await page.close();
  }
  report.status = report.diagnosticSelection ? "diagnostic-passed" : "passed";
} catch (error) {
  report.status = "failed";
  report.error = { message: error.message, stack: error.stack };
  throw error;
} finally {
  report.completedAt = new Date().toISOString();
  await save();
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
