import { execFileSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, extname, join, resolve, sep } from "node:path";
import { expect, test } from "playwright/test";

const root = resolve(__dirname, "../..");
const sandbox = join(root, ".tmp/examples-runtime");
const names = ["react", "vue", "vanilla-vite", "wechat-webview", "vanilla", "cdn"] as const;
const modelPath = join(root, "models/pp-detection/picodet-l-320-fp32.onnx");
let server: Server;
let origin = "";
let servingName: (typeof names)[number] = "react";

function pnpm(args: string[], cwd: string) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  execFileSync(command, commandArgs, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, CI: "true", pnpm_config_verify_deps_before_run: "false" }
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  mkdirSync(sandbox, { recursive: true });
  for (const name of names) {
    const target = join(sandbox, name);
    cpSync(join(root, "examples", name), target, {
      recursive: true,
      filter: (path) => !["node_modules", "dist"].includes(basename(path))
    });
    if (!["cdn", "vanilla"].includes(name)) {
      expect(
        JSON.parse(readFileSync(join(target, "package.json"), "utf8")).dependencies[
          "web-sdk-pp-detection"
        ]
      ).toBe("0.3.0");
      if (process.env.PPDETECTION_EXAMPLES_REUSE !== "1")
        pnpm(["install", "--ignore-scripts", "--no-frozen-lockfile", "--ignore-workspace"], target);
      pnpm(["run", "build"], target);
    }
  }
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const directory = join(
      sandbox,
      servingName,
      ["cdn", "vanilla"].includes(servingName) ? "" : "dist"
    );
    const file = resolve(directory, pathname.slice(1) || "index.html");
    if (
      !file.startsWith(resolve(directory) + sep) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type":
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".wasm": "application/wasm",
            ".css": "text/css"
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream"
    });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("示例服务器启动失败");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const name of names) {
  test(`${name} 快速重复点击只加载一次，取消后可以再次操作`, async ({ page }) => {
    if (process.env.PPDETECTION_EXAMPLES_EXTERNAL === "1") test.skip();
    servingName = name;
    let release!: () => void;
    let requests = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      "https://cdn.jsdelivr.net/npm/web-sdk-pp-detection@0.3.0/dist/browser-global.js",
      (route) =>
        route.fulfill({
          path: join(sandbox, "react/node_modules/web-sdk-pp-detection/dist/browser-global.js"),
          contentType: "text/javascript"
        })
    );
    await page.route("https://www.modelscope.cn/**/manifest.json*", async (route) => {
      requests += 1;
      await gate;
      await route
        .fulfill({
          path: join(root, "models/pp-detection/manifest.json"),
          contentType: "application/json"
        })
        .catch(() => undefined);
    });
    try {
      await page.goto(origin);
      await page
        .locator('input[type="file"]')
        .setInputFiles(join(root, "apps/demo/public/samples/people.jpg"));
      await page.getByRole("button", { name: "检测", exact: true }).evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await expect.poll(() => requests).toBe(1);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      release();
      await expect(page.getByRole("button", { name: "检测", exact: true })).toBeEnabled();
      await expect(page.getByText("已取消并释放模型", { exact: true })).toBeVisible();
      expect(requests).toBe(1);
      await expect(page.locator("pre")).toBeEmpty();
    } finally {
      release();
    }
  });

  test(`${name} 原样公开 SDK 初始化并运行官方 PicoDet 模型`, async ({ page }) => {
    test.skip(!existsSync(modelPath), "需要已校验的官方模型本体");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // 网络隔离使用官方模型与公开 npm 0.3.0 的原始字节，不替换 SDK API 或推理。
    if (process.env.PPDETECTION_EXAMPLES_EXTERNAL !== "1") {
      const sdkPath = join(
        sandbox,
        "react/node_modules/web-sdk-pp-detection/dist/browser-global.js"
      );
      await page.route(
        "https://cdn.jsdelivr.net/npm/web-sdk-pp-detection@0.3.0/dist/browser-global.js",
        (route) => route.fulfill({ path: sdkPath, contentType: "text/javascript" })
      );
      await page.route("https://www.modelscope.cn/**/manifest.json*", (route) =>
        route.fulfill({
          path: join(root, "models/pp-detection/manifest.json"),
          contentType: "application/json"
        })
      );
      await page.route(/https:\/\/.*\.onnx(?:\?.*)?$/u, (route) =>
        route.fulfill({ path: modelPath, contentType: "application/octet-stream" })
      );
    }
    servingName = name;
    await page.goto(origin);
    await page
      .locator('input[type="file"]')
      .setInputFiles(join(root, "apps/demo/public/samples/people.jpg"));
    await page.getByRole("button", { name: "检测", exact: true }).click();
    await expect(page.locator("pre")).not.toBeEmpty({ timeout: 90_000 });
    const result = JSON.parse(await page.locator("pre").innerText());
    expect(result, JSON.stringify(result)).toHaveProperty("detections");
    expect(result.model.id).toBe("pp-picodet-l-320");
    expect(result.detections.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await expect(page.getByRole("button", { name: "检测", exact: true })).toBeEnabled();
    console.log(
      JSON.stringify({
        example: name,
        model: result.model.id,
        sdk: "0.3.0",
        backend: result.runtime.backend,
        detections: result.detections.length,
        network:
          process.env.PPDETECTION_EXAMPLES_EXTERNAL === "1"
            ? "真实外网，未拦截请求"
            : "官方模型字节本地隔离；SDK 公共 npm 原包"
      })
    );
  });
}
