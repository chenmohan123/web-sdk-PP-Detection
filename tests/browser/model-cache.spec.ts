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

declare global {
  interface Window {
    sdk?: typeof import("../../packages/sdk/src/index");
  }
}
