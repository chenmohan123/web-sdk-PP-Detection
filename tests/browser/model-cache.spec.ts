import { execFileSync } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";

import { expect, test } from "playwright/test";

const repositoryRoot = resolve(__dirname, "../..");
const sdkRoot = join(repositoryRoot, "packages/sdk");
let server: Server;
let origin = "";

function buildSdk(): void {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", "--filter", "web-sdk-pp-detection", "build"]
      : ["--filter", "web-sdk-pp-detection", "build"];
  execFileSync(command, args, { cwd: repositoryRoot, stdio: "pipe" });
}

test.beforeAll(async () => {
  buildSdk();
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><script type="module">import * as sdk from "/index.js"; globalThis.sdk = sdk;</script>'
      );
      return;
    }
    if (request.url !== "/index.js") {
      response.writeHead(404).end();
      return;
    }
    const path = join(sdkRoot, "dist/index.js");
    response.writeHead(200, {
      "content-length": statSync(path).size,
      "content-type": "text/javascript; charset=utf-8"
    });
    createReadStream(path).pipe(response);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("缓存测试服务器启动失败");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error === undefined ? resolveClose() : reject(error)));
  });
});

test("IndexedDB 缓存支持跨实例读取、估算和两级清理", async ({ page }) => {
  await page.goto(origin);
  await expect
    .poll(() => page.evaluate(() => typeof window.sdk?.IndexedDBModelCache))
    .toBe("function");
  const result = await page.evaluate(async () => {
    const databaseName = `pp-detection-cache-test-${crypto.randomUUID()}`;
    const first = new window.sdk!.IndexedDBModelCache({ databaseName });
    await first.put("a", new Uint8Array([1, 2]).buffer);
    await first.put("b", new Uint8Array([3, 4, 5]).buffer);
    await first.close();

    const second = new window.sdk!.IndexedDBModelCache({ databaseName });
    const cached = new Uint8Array((await second.get("a"))!);
    cached[0] = 9;
    const unchanged = Array.from(new Uint8Array((await second.get("a"))!));
    const initial = await second.estimate();
    await second.clearCurrent("a");
    const currentCleared = await second.estimate();
    await second.clearAll();
    const allCleared = await second.estimate();
    await second.close();
    return { allCleared, currentCleared, initial, unchanged };
  });

  expect(result).toEqual({
    initial: { bytes: 5, entries: 2 },
    currentCleared: { bytes: 3, entries: 1 },
    allCleared: { bytes: 0, entries: 0 },
    unchanged: [1, 2]
  });
});

for (const scope of ["current", "all"] as const) {
  test(`跨管理器共享 IndexedDB 的 ${scope} 清理使旧下载失效`, async ({ page }) => {
    await page.goto(origin);
    await expect.poll(() => page.evaluate(() => typeof window.sdk?.ModelManager)).toBe("function");
    const result = await page.evaluate(async (scope) => {
      const sdk = window.sdk!;
      const databaseName = `detection-shared-${crypto.randomUUID()}`;
      const firstCache = new sdk.IndexedDBModelCache({ databaseName });
      const secondCache = new sdk.IndexedDBModelCache({ databaseName });
      const independentCache = new sdk.IndexedDBModelCache({
        databaseName: `${databaseName}-other-sdk`
      });
      await independentCache.put("other-sdk", new ArrayBuffer(7));
      const source = {
        kind: "custom",
        repository: "test",
        revision: "a".repeat(40),
        path: "m.onnx",
        downloadUrl: "https://example.com/m.onnx",
        bytes: 4,
        sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a"
      };
      const manifest = {
        schemaVersion: 1,
        model: { id: "m", version: "1" },
        input: { name: "image", shape: [1, 3, 1, 1], dtype: "float32" },
        outputs: [{ name: "dets", shape: [1, 1, 6], dtype: "float32" }],
        preprocessing: { size: { width: 1, height: 1 }, rescaleFactor: 1 },
        postprocessing: { type: "nms", scoreThreshold: 0.4, iouThreshold: 0.5 },
        labels: ["x"],
        variants: [
          {
            id: "fp32",
            precision: "fp32",
            quantization: null,
            opset: 11,
            bytes: 4,
            parameterCount: 1,
            backends: ["wasm"],
            sources: [source]
          }
        ]
      };
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const first = new sdk.ModelManager({
        cache: firstCache,
        fetcher: async () => {
          entered();
          await gate;
          return new Response(new Uint8Array([1, 2, 3, 4]));
        }
      });
      const second = new sdk.ModelManager({
        cache: secondCache,
        fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
      });
      const loading = first.load({ manifest });
      await started;
      if (scope === "current") await second.clearCurrentModelCache(manifest.model);
      else await second.clearAllCache();
      release();
      await loading;
      const cleared = await second.getCacheEstimate();
      await second.load({ manifest });
      const reloaded = await second.getCacheEstimate();
      const independent = await independentCache.estimate();
      await Promise.all([first.dispose(), second.dispose(), independentCache.close()]);
      return { cleared, reloaded, independent };
    }, scope);
    expect(result).toEqual({
      cleared: { bytes: 0, entries: 0 },
      reloaded: { bytes: 4, entries: 1 },
      independent: { bytes: 7, entries: 1 }
    });
  });
}

declare global {
  interface Window {
    sdk?: typeof import("../../packages/sdk/src/index");
  }
}

test("模块清理同步清除活动管理器的内存缓存副本", async ({ page }) => {
  await page.goto(origin);
  await expect.poll(() => page.evaluate(() => typeof window.sdk?.ModelManager)).toBe("function");
  const result = await page.evaluate(async () => {
    const sdk = window.sdk!;
    let downloads = 0;
    const manager = new sdk.ModelManager({
      fetcher: async () => {
        downloads += 1;
        return new Response(new Uint8Array([1, 2, 3, 4]));
      }
    });
    const manifest = {
      schemaVersion: 1,
      model: { id: "active-memory", version: "1" },
      input: { name: "image", shape: [1, 3, 1, 1], dtype: "float32" },
      outputs: [{ name: "dets", shape: [1, 1, 6], dtype: "float32" }],
      preprocessing: { size: { width: 1, height: 1 }, rescaleFactor: 1 },
      postprocessing: { type: "nms", scoreThreshold: 0.4, iouThreshold: 0.5 },
      labels: ["x"],
      variants: [
        {
          id: "fp32",
          precision: "fp32",
          quantization: null,
          opset: 11,
          bytes: 4,
          parameterCount: 1,
          backends: ["wasm"],
          sources: [
            {
              kind: "custom",
              repository: "test",
              revision: "a".repeat(40),
              path: "m.onnx",
              downloadUrl: "https://example.com/m.onnx",
              bytes: 4,
              sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a"
            }
          ]
        }
      ]
    };
    await manager.clearAllCache();
    await manager.load({ manifest });
    const warm = (await manager.load({ manifest })).fromCache;
    await sdk.clearModelCache();
    const cleared = await manager.getCacheEstimate();
    const reloaded = (await manager.load({ manifest })).fromCache;
    await manager.dispose();
    return { warm, cleared, reloaded, downloads };
  });
  expect(result).toEqual({
    warm: true,
    cleared: { bytes: 0, entries: 0 },
    reloaded: false,
    downloads: 2
  });
});
