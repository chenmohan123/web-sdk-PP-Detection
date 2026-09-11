import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// 对真实 Demo 与公开模型执行验收；不拦截请求，不使用 fixture 或修改模型输出。
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../../..");
const directory = process.env.PPDETECTION_REPORT_DIRECTORY
  ? resolve(root, process.env.PPDETECTION_REPORT_DIRECTORY)
  : scriptDirectory;
const source = process.env.PPDETECTION_DEMO_SOURCE ?? "huggingface";
assert(["huggingface", "modelscope"].includes(source));
const expectedVersion = process.env.PPDETECTION_EXPECTED_VERSION ?? "0.1.0-labs.1";
const expectStable = process.env.PPDETECTION_EXPECT_STABLE === "1";
const backends = (process.env.PPDETECTION_DEMO_BACKENDS ?? "wasm,webgpu").split(",");
assert(backends.length > 0 && backends.every((backend) => ["wasm", "webgpu"].includes(backend)));
await mkdir(directory, { recursive: true });
const origin = process.env.PPDETECTION_DEMO_URL ?? "http://127.0.0.1:4174";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifacts = [
  "apps/demo/src/App.tsx",
  "apps/demo/src/model-sources.ts",
  "apps/demo/src/execution-preferences.ts",
  "apps/demo/src/styles.css",
  "models/pp-detection/manifest.json",
  "models/ppyoloe-plus-s-640/manifest.json",
  "packages/sdk/dist/index.js"
];
const report = {
  testedAt: new Date().toISOString(),
  status: "running",
  scope: "真实桌面 Chromium；390px 仅验证布局，不代表小米 15 实机",
  origin,
  source,
  expectedVersion,
  expectStable,
  requestedBackends: backends,
  files: {},
  runs: [],
  steps: [],
  requests: [],
  requestUrlsOmitQuery: true,
  browserMessages: [],
  httpErrors: [],
  pageErrors: []
};
let browser;
let page;
const withoutQuery = (url) => url.split(/[?#]/u)[0];
try {
  for (const file of artifacts) {
    report.files[file] = digest(await readFile(resolve(root, file)));
  }
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes(".onnx")) {
      report.requests.push({
        event: "request",
        url: withoutQuery(request.url()),
        at: new Date().toISOString()
      });
    }
  });
  page.on("requestfailed", (request) => {
    report.requests.push({
      event: "failed",
      url: withoutQuery(request.url()),
      error: request.failure()
    });
  });
  page.on("requestfinished", (request) => {
    if (request.url().includes(".onnx")) {
      report.requests.push({
        event: "finished",
        url: withoutQuery(request.url()),
        at: new Date().toISOString()
      });
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      report.httpErrors.push({ url: response.url(), status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      report.browserMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location()
      });
    }
  });
  await page.goto(origin);
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const info = adapter?.info;
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      secureContext: isSecureContext,
      crossOriginIsolated,
      gpu: adapter
        ? {
            vendor: info?.vendor ?? null,
            architecture: info?.architecture ?? null,
            device: info?.device || null,
            description: info?.description || null,
            isFallbackAdapter: info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null
          }
        : null
    };
  });
  report.environment.browserVersion = browser.version();
  const modelSelect = page.locator("select").filter({
    has: page.locator("option").filter({ hasText: "PP-YOLOE" })
  });
  const options = await modelSelect
    .locator("option")
    .evaluateAll((elements) =>
      elements.map((option) => ({ value: option.value, text: option.textContent }))
    );
  const stableOption = options.find((option) => option.text.includes("PicoDet"));
  const candidateOption = options.find((option) => option.text.includes("PP-YOLOE"));
  assert(stableOption && candidateOption, "必须同时提供 PicoDet 和 PP-YOLOE 模型");
  if (expectStable) assert.doesNotMatch(candidateOption.text, /实验/u);
  assert.equal(await modelSelect.inputValue(), stableOption.value);
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  await page.locator(".sample-card").first().click();

  async function run(selected, backend, repeat) {
    const step = { model: selected.value, backend, repeat, phase: "选择模型" };
    report.steps.push(step);
    await modelSelect.selectOption(selected.value);
    await page.getByLabel("模型来源", { exact: true }).selectOption(source);
    await page
      .getByRole("button", { name: backend === "wasm" ? "CPU" : "GPU", exact: true })
      .click();
    if (!repeat) {
      step.phase = "清理缓存";
      await page.locator('[data-sdk-cache-clear="current"]').click();
      await page.locator('[data-sdk-cache-clear="current"]').waitFor({ state: "visible" });
      await page.waitForFunction(
        () => !document.querySelector('[data-sdk-cache-clear="current"]').disabled
      );
    }
    step.phase = "开始检测";
    await page.getByRole("button", { name: "开始检测", exact: true }).click();
    step.phase = "等待结果";
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="status"]')?.textContent ?? "";
      return status.includes("检测完成") || document.querySelector('[role="alert"]');
    });
    assert.match(
      await page.getByTestId("status").innerText(),
      /检测完成/u,
      await page.locator('[role="alert"]').allTextContents()
    );
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
    const download = await downloadPromise;
    const filename = `desktop-${selected === stableOption ? "picodet" : "ppyoloe"}-${backend}-${repeat ? "cached" : "cold"}.json`;
    await download.saveAs(resolve(directory, filename));
    const result = JSON.parse(await readFile(resolve(directory, filename), "utf8"));
    const expectedId = selected === stableOption ? "pp-picodet-l-320" : "ppyoloe-plus-s-640";
    assert.equal(result.model.id, expectedId);
    assert.equal(result.runtime.backend, backend);
    assert.equal(result.model.source.kind, source, "实际来源必须符合显式选择");
    assert.equal(result.runtime.fallbacks.length, 0, "显式选择后端不应回退");
    assert(result.detections.length > 0, "示例图片应产生真实检测结果");
    if (selected === candidateOption) {
      assert.equal(result.model.version, expectedVersion);
      assert.equal(
        result.model.source.sha256,
        "d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c"
      );
    }
    report.runs.push({
      model: result.model,
      backend,
      cacheRequested: repeat,
      export: filename,
      runtime: result.runtime,
      timings: result.timings,
      initialization: await page.getByTestId("initialization-timings").innerText(),
      detectionCount: result.detections.length
    });
    step.phase = "完成";
    console.log(JSON.stringify(step));
  }

  if (backends.includes("wasm")) {
    await run(stableOption, "wasm", false);
    await run(candidateOption, "wasm", false);
    await run(candidateOption, "wasm", true);
  }
  if (backends.includes("webgpu")) {
    if (report.environment.gpu) {
      await run(stableOption, "webgpu", false);
      await run(candidateOption, "webgpu", false);
    } else {
      report.webgpu = "当前浏览器没有适配器，未执行该后端";
    }
  }
  await page.screenshot({ path: resolve(directory, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  report.narrowLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert(
    report.narrowLayout.scrollWidth <= report.narrowLayout.clientWidth,
    "390px 不应存在横向溢出"
  );
  await page.screenshot({ path: resolve(directory, "narrow-390.png"), fullPage: true });
  await modelSelect.selectOption(stableOption.value);
  assert.equal(
    await page.getByRole("button", { name: "导出 JSON", exact: true }).isDisabled(),
    true
  );
  assert.equal(report.pageErrors.length, 0, "浏览器页面不得出现未处理异常");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = { name: error.name, message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    report.failurePage = await page
      .locator("body")
      .innerText()
      .catch(() => null);
    await page
      .screenshot({ path: resolve(directory, "failure.png"), fullPage: true })
      .catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(
    resolve(directory, "desktop-browser.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      status: report.status,
      runs: report.runs.length,
      error: report.error?.message
    })
  );
}
