import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, extname, join, normalize, resolve } from "node:path";

import { expect, test, type Page } from "playwright/test";

const repositoryRoot = resolve(__dirname, "../..");
const sdkRoot = join(repositoryRoot, "packages/sdk");
const ortRoot = join(sdkRoot, "node_modules/onnxruntime-web/dist");
const modelRoot = join(repositoryRoot, "models/pp-detection/1.0.0");
const fixtureRoot = join(repositoryRoot, "tools/model-pipeline/fixtures/images");
const modelPath = join(modelRoot, "picodet-l-320-fp32.onnx");
const modelBytes = 23219047;
const modelSha256 = "a7e1fbfe20f07fd7a7567811a4e2670df0595f0fecb885505d7d93466990e982";

let server: Server;
let origin = "";

function runPnpm(args: readonly string[]): void {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  execFileSync(command, commandArgs, { cwd: repositoryRoot, stdio: "pipe" });
}

function contentType(path: string): string {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".onnx": "application/octet-stream",
      ".wasm": "application/wasm",
      ".jpg": "image/jpeg",
      ".png": "image/png"
    }[extname(path)] ?? "application/octet-stream"
  );
}

function resolveAsset(url: string): string | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith("/dist/")) return join(sdkRoot, pathname.slice(1));
  if (pathname.startsWith("/ort/")) return join(ortRoot, basename(pathname));
  if (pathname === "/models/picodet-l-320-fp32.onnx") return modelPath;
  if (pathname.startsWith("/fixtures/")) return join(fixtureRoot, basename(pathname));
  return undefined;
}

function manifest(downloadUrl: string) {
  return {
    schemaVersion: 1 as const,
    model: { id: "pp-picodet-l-320", version: "1.0.0" },
    input: { name: "image", shape: [1, 3, 320, 320], dtype: "float32" },
    outputs: [
      { name: "multiclass_nms3_0.tmp_0", shape: [-1, 6], dtype: "float32" },
      { name: "multiclass_nms3_0.tmp_2", shape: [1], dtype: "int32" }
    ],
    preprocessing: {
      size: { width: 320, height: 320 },
      resizeMode: "stretch" as const,
      rescaleFactor: 1 / 255,
      doResize: true,
      doRescale: true,
      doNormalize: true,
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225]
    },
    postprocessing: {
      type: "nms" as const,
      scoreThreshold: 0.5,
      iouThreshold: 0.5,
      matrixCoordinates: "pixels" as const
    },
    labels: Array.from({ length: 80 }, (_, index) => `coco-${index}`),
    variants: [
      {
        id: "fp32-wasm-webgpu",
        precision: "fp32" as const,
        quantization: null,
        opset: 11,
        bytes: modelBytes,
        parameterCount: 5787988,
        backends: ["wasm", "webgpu"] as const,
        status: "stable" as const,
        sources: [
          {
            kind: "custom" as const,
            repository: "local://picodet",
            revision: modelSha256,
            path: "picodet-l-320-fp32.onnx",
            downloadUrl,
            bytes: modelBytes,
            sha256: modelSha256
          }
        ]
      }
    ]
  };
}

async function runDetection(page: Page, backend: "wasm" | "webgpu") {
  await page.goto(origin);
  return await page.evaluate(
    async ({ backend: requestedBackend, downloadUrl, runtimeManifest, wasmPaths }) => {
      const [modelResponse, imageResponse] = await Promise.all([
        fetch(downloadUrl),
        fetch(`${new URL(downloadUrl).origin}/fixtures/layout-demo.jpg`)
      ]);
      if (!modelResponse.ok || !imageResponse.ok) throw new Error("PicoDet 测试资产下载失败");
      const detector = await window.PPDetection!.createPPDetection({
        allowFallback: false,
        backend: requestedBackend,
        cache: false,
        model: {
          data: await modelResponse.arrayBuffer(),
          manifest: runtimeManifest
        },
        ort: { wasm: { numThreads: 1, paths: wasmPaths } },
        precision: "fp32"
      });
      try {
        const result = await detector.detect(await imageResponse.blob(), { threshold: 0.5 });
        return {
          browser: {
            language: navigator.language,
            userAgent: navigator.userAgent
          },
          detections: result.detections.length,
          first: result.detections[0],
          loadTimings: detector.loadTimings,
          model: detector.model,
          runtime: detector.runtime,
          timings: result.timings
        };
      } finally {
        await detector.dispose();
      }
    },
    {
      backend,
      downloadUrl: `${origin}/models/picodet-l-320-fp32.onnx`,
      runtimeManifest: manifest(`${origin}/models/picodet-l-320-fp32.onnx`),
      wasmPaths: `${origin}/ort/`
    }
  );
}

test.beforeAll(async () => {
  if (!existsSync(modelPath)) throw new Error(`缺少 PicoDet 本地模型: ${modelPath}`);
  runPnpm(["--filter", "web-sdk-pp-detection", "build"]);
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><script>globalThis.Worker=undefined;globalThis.__picodetManifest=${JSON.stringify(
          manifest("http://127.0.0.1/models/picodet-l-320-fp32.onnx")
        )}</script><script src="/dist/browser-global.js"></script>`
      );
      return;
    }
    const asset = resolveAsset(request.url ?? "");
    const safeAsset = asset === undefined ? undefined : normalize(asset);
    if (safeAsset === undefined || !existsSync(safeAsset) || !statSync(safeAsset).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-length": statSync(safeAsset).size,
      "content-type": contentType(safeAsset)
    });
    createReadStream(safeAsset).pipe(response);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("PicoDet 浏览器服务器启动失败");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error === undefined ? resolveClose() : reject(error)))
  );
});

test("PicoDet 本地候选在浏览器 WASM/CPU 中完成 Session 和推理", async ({ page }) => {
  const result = await runDetection(page, "wasm");
  console.log(`[picodet-browser-evidence] ${JSON.stringify({ backend: "wasm", ...result })}`);
  expect(result.runtime).toMatchObject({ backend: "wasm", precision: "fp32" });
  expect(result.detections).toBeGreaterThan(0);
  expect(result.loadTimings.sessionMs).toBeGreaterThan(0);
  expect(result.timings.inferenceMs).toBeGreaterThan(0);
  expect(result.timings.totalMs).toBeGreaterThan(0);
  expect(result.model).toMatchObject({
    bytes: modelBytes,
    id: "pp-picodet-l-320",
    parameterCount: 5787988,
    precision: "fp32",
    variantId: "fp32-wasm-webgpu",
    version: "1.0.0"
  });
});

test("PicoDet 在浏览器支持 GPU API 时验证 WebGPU，否则记录 unsupported", async ({ page }) => {
  await page.goto(origin);
  const available = await page.evaluate(async () => {
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter(options?: { powerPreference?: string }): Promise<unknown>;
        };
      }
    ).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: "high-performance" });
    return adapter !== undefined && adapter !== null;
  });
  if (!available) {
    test.info().annotations.push({
      type: "unsupported",
      description: "当前 Chromium 未暴露 WebGPU adapter"
    });
    console.log('[picodet-browser-evidence] {"backend":"webgpu","status":"unsupported"}');
    test.skip(true, "当前 Chromium 未暴露 WebGPU adapter");
  }
  const result = await runDetection(page, "webgpu");
  console.log(`[picodet-browser-evidence] ${JSON.stringify({ backend: "webgpu", ...result })}`);
  expect(result.runtime).toMatchObject({ backend: "webgpu", precision: "fp32" });
  expect(result.detections).toBeGreaterThan(0);
  expect(result.loadTimings.sessionMs).toBeGreaterThan(0);
  expect(result.timings.inferenceMs).toBeGreaterThan(0);
});

declare global {
  interface Window {
    PPDetection?: typeof import("../../packages/sdk/src/index");
    __picodetManifest?: unknown;
  }
}
