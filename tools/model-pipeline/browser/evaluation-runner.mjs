import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED_FLAGS = ["model", "manifest", "annotations", "image-root", "backend", "output"];
const SOFTWARE_ADAPTER_PATTERN = /swiftshader|llvmpipe|lavapipe|warp|software|basic render/iu;
const BROWSER_LAUNCH_ARGS = [];

export function validateCategoryMapping(labels, categories) {
  const ordered = [...categories].sort((left, right) => left.id - right.id);
  const ids = ordered.map((category) => category.id);
  if (ids.some((id) => !Number.isInteger(id)) || new Set(ids).size !== ids.length) {
    throw new TypeError("COCO 类别 ID 必须是唯一整数");
  }
  if (
    labels.length !== ordered.length ||
    ordered.some((category, index) => category.name !== labels[index])
  ) {
    throw new TypeError("模型标签必须与按 COCO 原始 ID 排序的类别名称和顺序一致");
  }
  return ids;
}

function flagMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new TypeError(`无法识别参数：${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`参数 --${name} 缺少值`);
    if (values.has(name)) throw new TypeError(`参数 --${name} 不能重复`);
    values.set(name, value);
    index += 1;
  }
  return values;
}

export function parseEvaluationOptions(argv) {
  const values = flagMap(argv);
  const missing = REQUIRED_FLAGS.filter((name) => !values.has(name));
  if (missing.length > 0)
    throw new TypeError(`缺少必填参数：${missing.map((x) => `--${x}`).join("、")}`);
  const allowed = new Set([...REQUIRED_FLAGS, "expected-images"]);
  const unknown = [...values.keys()].filter((name) => !allowed.has(name));
  if (unknown.length > 0) throw new TypeError(`无法识别参数：--${unknown[0]}`);
  const backend = values.get("backend");
  if (backend !== "wasm" && backend !== "webgpu") {
    throw new TypeError("--backend 只能是 wasm 或 webgpu");
  }
  const expectedImages = Number(values.get("expected-images") ?? "64");
  if (!Number.isInteger(expectedImages) || expectedImages < 1) {
    throw new TypeError("--expected-images 必须是正整数");
  }
  return {
    annotations: values.get("annotations"),
    backend,
    expectedImages,
    imageRoot: values.get("image-root"),
    manifest: values.get("manifest"),
    model: values.get("model"),
    output: values.get("output")
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarizeWarmRuns(runs) {
  const values = runs
    .slice(1)
    .map((run) => run.wallClockMs)
    .filter((value) => Number.isFinite(value));
  return {
    count: values.length,
    medianMs: percentile(values, 0.5),
    p90Ms: percentile(values, 0.9)
  };
}

export function classifyAdapter(adapter) {
  if (!adapter) return { physical: false, reason: "浏览器没有返回 WebGPU 适配器" };
  if (adapter.isFallbackAdapter === true)
    return { physical: false, reason: "适配器标记为回退实现" };
  const identity = [adapter.vendor, adapter.device, adapter.description, adapter.architecture]
    .filter(Boolean)
    .join(" ");
  if (SOFTWARE_ADAPTER_PATTERN.test(identity)) {
    return { physical: false, reason: "检测到软件适配器" };
  }
  if (!identity) {
    return { physical: false, reason: "适配器身份信息不足" };
  }
  return { physical: true, reason: null };
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function readJson(path, description) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new Error(`无法读取${description}：${path}`, { cause: error });
  }
  try {
    return { bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(`${description}不是有效 JSON：${path}`, { cause: error });
  }
}

async function fileEvidence(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.byteLength, path, sha256: sha256(bytes) };
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error), name: "UnknownError" };
  return {
    message: error.message,
    name: error.name,
    stack: error.stack ?? null,
    cause: error.cause instanceof Error ? serializeError(error.cause) : (error.cause ?? null)
  };
}

function contentType(path) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".wasm": "application/wasm"
    }[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

async function startAssetServer({ imageAssets, modelPath, ortDirectory, sdkPath }) {
  const routes = new Map([
    ["/dist/browser-global.js", sdkPath],
    ["/model/model.onnx", modelPath]
  ]);
  for (const image of imageAssets)
    routes.set(`/images/${encodeURIComponent(image.fileName)}`, image.path);
  for (const name of await readdir(ortDirectory)) {
    if (/^ort(?:-|\.).*\.(?:js|mjs|wasm)$/u.test(name))
      routes.set(`/ort/${name}`, join(ortDirectory, name));
  }
  const html = Buffer.from(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"/><title>PP-Detection 浏览器评测</title><script src="/dist/browser-global.js"></script><body></body></html>',
    "utf8"
  );
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (pathname === "/" || pathname === "/index.html") {
      response.writeHead(200, {
        "Content-Length": html.byteLength,
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(html);
      return;
    }
    const path = routes.get(pathname);
    if (!path) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new Error("资源不是文件");
      response.writeHead(200, {
        "Content-Length": metadata.size,
        "Content-Type": contentType(path)
      });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法获得本地评测服务器端口");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
      );
    }
  };
}

function runtimeManifestForEvaluation(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.variants)) {
    throw new TypeError("模型清单缺少 variants");
  }
  if (!Array.isArray(manifest.labels) || manifest.labels.length === 0) {
    throw new TypeError("模型清单缺少 labels");
  }
  return {
    ...manifest,
    postprocessing: {
      ...manifest.postprocessing,
      iouThreshold: 1,
      scoreThreshold: 0.001
    }
  };
}

async function collectInputs(options) {
  const root = process.cwd();
  const paths = {
    annotations: resolve(root, options.annotations),
    imageRoot: resolve(root, options.imageRoot),
    manifest: resolve(root, options.manifest),
    model: resolve(root, options.model),
    output: resolve(root, options.output)
  };
  const [annotations, manifest, model] = await Promise.all([
    readJson(paths.annotations, "数据集标注"),
    readJson(paths.manifest, "模型清单"),
    fileEvidence(paths.model)
  ]);
  const dataset = annotations.value;
  if (!Array.isArray(dataset.images) || !Array.isArray(dataset.categories)) {
    throw new TypeError("数据集标注缺少 images 或 categories");
  }
  if (dataset.images.length !== options.expectedImages) {
    throw new RangeError(
      `数据集应包含 ${options.expectedImages} 张图片，实际为 ${dataset.images.length} 张`
    );
  }
  const manifestValue = runtimeManifestForEvaluation(manifest.value);
  const categoryIds = validateCategoryMapping(manifestValue.labels, dataset.categories);
  if (manifestValue.labels.length !== categoryIds.length) {
    throw new RangeError(
      `模型标签数 ${manifestValue.labels.length} 与数据集类别数 ${categoryIds.length} 不一致`
    );
  }
  const imageAssets = [];
  const seenNames = new Set();
  for (const image of dataset.images) {
    if (!Number.isInteger(image.id) || typeof image.file_name !== "string") {
      throw new TypeError("数据集图片必须包含整数 id 和字符串 file_name");
    }
    if (basename(image.file_name) !== image.file_name || seenNames.has(image.file_name)) {
      throw new TypeError(`数据集图片文件名无效或重复：${image.file_name}`);
    }
    seenNames.add(image.file_name);
    const path = join(paths.imageRoot, image.file_name);
    const evidence = await fileEvidence(path);
    imageAssets.push({ fileName: image.file_name, imageId: image.id, path, ...evidence });
  }
  const imageSetSha256 = sha256(
    Buffer.from(
      imageAssets.map(({ fileName, sha256 }) => `${fileName}:${sha256}`).join("\n"),
      "utf8"
    )
  );
  return {
    annotations,
    categoryIds,
    imageAssets,
    imageSetSha256,
    manifest: { ...manifest, value: manifestValue },
    model,
    paths
  };
}

function hostEnvironment() {
  const cpus = os.cpus();
  return {
    cpu: {
      logicalCores: cpus.length,
      model: cpus[0]?.model ?? null
    },
    os: {
      arch: os.arch(),
      platform: os.platform(),
      release: os.release()
    }
  };
}

async function inspectAdapter(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    globalThis.__PPDETECTION_EVALUATION_ADAPTER__ = adapter;
    const info = adapter.info ?? {};
    return {
      architecture: info.architecture || null,
      description: info.description || null,
      device: info.device || null,
      isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? null,
      subgroupMaxSize: info.subgroupMaxSize ?? null,
      subgroupMinSize: info.subgroupMinSize ?? null,
      vendor: info.vendor || null
    };
  });
}

async function evaluateInBrowser(page, payload) {
  return page.evaluate(async ({ backend, categoryIds, images, manifest, origin }) => {
    const ort = await import(
      backend === "webgpu" ? "/ort/ort.webgpu.min.mjs" : "/ort/ort.wasm.min.mjs"
    );
    ort.env.wasm.wasmPaths = `${origin}/ort/`;
    ort.env.wasm.numThreads = 1;
    if (backend === "webgpu") {
      ort.env.webgpu.adapter = globalThis.__PPDETECTION_EVALUATION_ADAPTER__;
    }
    const modelResponse = await fetch("/model/model.onnx", { cache: "no-store" });
    if (!modelResponse.ok) throw new Error(`模型读取失败：HTTP ${modelResponse.status}`);
    const modelData = await modelResponse.arrayBuffer();
    const detector = await globalThis.PPDetection.createPPDetection({
      allowExperimental: true,
      allowFallback: false,
      backend,
      cache: false,
      executionMode: "main",
      model: { data: modelData, manifest },
      ort: { module: ort, wasm: { numThreads: 1, paths: `${origin}/ort/` } },
      precision: "fp32"
    });
    try {
      const imageResults = [];
      const predictions = [];
      for (const [index, image] of images.entries()) {
        const response = await fetch(`/images/${encodeURIComponent(image.fileName)}`, {
          cache: "no-store"
        });
        if (!response.ok)
          throw new Error(`图片读取失败：${image.fileName}，HTTP ${response.status}`);
        const blob = await response.blob();
        const startedAt = performance.now();
        const result = await detector.detect(blob, { threshold: 0.001 });
        const wallClockMs = performance.now() - startedAt;
        for (const detection of result.detections) {
          const categoryId = categoryIds[detection.classId];
          if (!Number.isInteger(categoryId)) {
            throw new Error(`检测类别索引超出 COCO 映射范围：${detection.classId}`);
          }
          predictions.push({
            bbox: [detection.box.x, detection.box.y, detection.box.width, detection.box.height],
            category_id: categoryId,
            image_id: image.imageId,
            score: detection.score
          });
        }
        imageResults.push({
          detectionCount: result.detections.length,
          fileName: image.fileName,
          imageId: image.imageId,
          sha256: image.sha256,
          timings: result.timings,
          wallClockMs
        });
        if ((index + 1) % 8 === 0 || index + 1 === images.length) {
          console.log(`${backend}：${index + 1}/${images.length}`);
        }
      }
      return {
        images: imageResults,
        loadTimings: detector.loadTimings,
        model: detector.model,
        onnxruntimeWebVersion: ort.env.versions.web,
        predictions,
        runtime: detector.runtime,
        sdkVersion: globalThis.PPDetection.CURRENT_SDK_VERSION
      };
    } finally {
      await detector.dispose();
    }
  }, payload);
}

export async function runEvaluation(options) {
  const capturedAt = new Date().toISOString();
  const host = hostEnvironment();
  let browser;
  let server;
  let browserEvidence = null;
  let adapter = null;
  const browserMessages = [];
  try {
    const inputs = await collectInputs(options);
    const browserDirectory = dirname(fileURLToPath(import.meta.url));
    const repositoryRoot = resolve(browserDirectory, "../../..");
    const sdkPath = join(repositoryRoot, "packages/sdk/dist/browser-global.js");
    const ortDirectory = join(repositoryRoot, "packages/sdk/node_modules/onnxruntime-web/dist");
    await Promise.all([stat(sdkPath), stat(ortDirectory)]);
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(
      repositoryRoot,
      ".tmp/dependencies-compatible-browsers"
    );
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      args: BROWSER_LAUNCH_ARGS,
      channel: "chromium",
      headless: true
    });
    server = await startAssetServer({
      imageAssets: inputs.imageAssets,
      modelPath: inputs.paths.model,
      ortDirectory,
      sdkPath
    });
    const page = await browser.newPage();
    page.on("console", (message) => {
      browserMessages.push({ text: message.text(), type: message.type() });
      console.log(`[browser:${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      browserMessages.push({ text: error.stack ?? error.message, type: "pageerror" });
      console.error(`[browser:pageerror] ${error.stack ?? error.message}`);
    });
    await page.goto(server.origin, { waitUntil: "load" });
    browserEvidence = {
      version: browser.version(),
      launchArgs: BROWSER_LAUNCH_ARGS,
      ...(await page.evaluate(() => ({
        crossOriginIsolated: globalThis.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency,
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        userAgentData: navigator.userAgentData
          ? {
              brands: navigator.userAgentData.brands,
              mobile: navigator.userAgentData.mobile,
              platform: navigator.userAgentData.platform
            }
          : null
      })))
    };
    adapter = await inspectAdapter(page);
    const adapterClassification = classifyAdapter(adapter);
    const common = {
      artifacts: {
        annotations: {
          path: inputs.paths.annotations,
          sha256: inputs.annotations.sha256
        },
        imageCount: inputs.imageAssets.length,
        imageSetSha256: inputs.imageSetSha256,
        manifest: {
          path: inputs.paths.manifest,
          sha256: inputs.manifest.sha256
        },
        model: inputs.model
      },
      capturedAt,
      environment: {
        ...host,
        browser: browserEvidence,
        browserMessages,
        gpu: { adapter, ...adapterClassification }
      },
      evaluation: {
        allowExperimental: true,
        allowFallback: false,
        executionMode: "main",
        expectedImages: options.expectedImages,
        manifestOverrides: { iouThreshold: 1, scoreThreshold: 0.001 },
        numThreads: 1,
        preprocessing: {
          interpolation: inputs.manifest.value.preprocessing?.interpolation ?? "bilinear",
          reference:
            inputs.manifest.value.preprocessing?.interpolation === "bicubic"
              ? "Pillow bicubic"
              : "SDK bilinear"
        },
        requestedBackend: options.backend,
        scoreThreshold: 0.001
      },
      schemaVersion: 1
    };
    if (options.backend === "webgpu" && !adapterClassification.physical) {
      return {
        ...common,
        reason: adapterClassification.reason,
        status: "unsupported"
      };
    }
    const result = await evaluateInBrowser(page, {
      backend: options.backend,
      categoryIds: inputs.categoryIds,
      images: inputs.imageAssets.map(({ fileName, imageId, sha256 }) => ({
        fileName,
        imageId,
        sha256
      })),
      manifest: inputs.manifest.value,
      origin: server.origin
    });
    if (
      result.runtime.backend !== options.backend ||
      result.runtime.mode !== "main" ||
      result.runtime.fallbacks.length !== 0
    ) {
      throw new Error("实际后端、执行模式或回退记录不符合严格评测要求");
    }
    return {
      ...common,
      images: result.images,
      loadTimings: result.loadTimings,
      model: result.model,
      performance: {
        firstImageMs: result.images[0]?.wallClockMs ?? null,
        sessionMs: result.loadTimings.sessionMs,
        warmRuns: summarizeWarmRuns(result.images)
      },
      predictions: result.predictions,
      runtime: result.runtime,
      runtimeVersions: {
        onnxruntimeWeb: result.onnxruntimeWebVersion,
        sdk: result.sdkVersion
      },
      status: "passed"
    };
  } catch (error) {
    return {
      capturedAt,
      environment: {
        ...host,
        browser: browserEvidence,
        browserMessages,
        gpu: { adapter, ...classifyAdapter(adapter) }
      },
      error: serializeError(error),
      evaluation: {
        allowExperimental: true,
        allowFallback: false,
        executionMode: "main",
        numThreads: 1,
        requestedBackend: options.backend
      },
      schemaVersion: 1,
      status: "failed"
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}

async function writeEvidence(path, evidence) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseEvaluationOptions(argv);
  } catch (error) {
    const outputIndex = argv.indexOf("--output");
    const output = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
    const evidence = {
      capturedAt: new Date().toISOString(),
      error: serializeError(error),
      schemaVersion: 1,
      status: "failed"
    };
    if (output) await writeEvidence(resolve(process.cwd(), output), evidence);
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const evidence = await runEvaluation(options);
  await writeEvidence(resolve(process.cwd(), options.output), evidence);
  console.log(
    JSON.stringify({ output: resolve(process.cwd(), options.output), status: evidence.status })
  );
  return evidence.status === "passed" ? 0 : evidence.status === "unsupported" ? 2 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
