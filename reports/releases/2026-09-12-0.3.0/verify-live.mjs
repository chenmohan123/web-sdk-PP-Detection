import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// 验证发布页面的真实推理、模型默认来源和交互，不拦截模型请求或替换输出。
const output = resolve(process.env.PPDETECTION_RELEASE_REPORT ?? ".tmp/release-0.3.0-live");
await mkdir(output, { recursive: true });
const report = {
  testedAt: new Date().toISOString(),
  url:
    process.env.PPDETECTION_RELEASE_URL ?? "https://chenmohan123.github.io/web-sdk-PP-Detection/",
  sdkVersion: "0.3.0",
  runs: [],
  layouts: [],
  requests: [],
  browserMessages: [],
  pageErrors: []
};
const browser = await chromium.launch({ channel: "chromium", headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      report.browserMessages.push({ type: message.type(), text: message.text() });
    }
  });
  for (const event of ["request", "requestfinished", "requestfailed"]) {
    page.on(event, (request) => {
      if (request.url().includes(".onnx")) {
        report.requests.push({
          event,
          url: request.url().split(/[?#]/u)[0],
          at: new Date().toISOString(),
          failure: request.failure()
        });
      }
    });
  }
  await page.goto(report.url);
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return {
      userAgent: navigator.userAgent,
      secureContext: isSecureContext,
      gpu: adapter
        ? {
            vendor: adapter.info?.vendor,
            architecture: adapter.info?.architecture,
            description: adapter.info?.description,
            isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter
          }
        : null
    };
  });
  assert.equal(await page.locator(".version").innerText(), "SDK 0.3.0");
  assert.equal(await page.getByLabel("检测模型", { exact: true }).inputValue(), "picodet-l-320");
  const geometry = () =>
    page.getByTestId("image-viewport").evaluate((element) => {
      const view = element.getBoundingClientRect();
      const panel = element.closest('[data-testid="result-panel"]').getBoundingClientRect();
      return { top: view.top - panel.top, width: view.width, height: view.height };
    });
  for (const model of ["picodet-l-320", "ppyoloe-plus-s-640"]) {
    await page.getByLabel("检测模型", { exact: true }).selectOption(model);
    assert.equal(await page.getByLabel("模型来源", { exact: true }).inputValue(), "modelscope");
    assert.deepEqual(
      await page.getByLabel("模型来源", { exact: true }).locator("option").allTextContents(),
      ["ModelScope", "Hugging Face"]
    );
    await page.locator(".sample-card").first().click();
    for (const backend of ["wasm", "webgpu"]) {
      report.currentRun = { model, backend };
      console.log(JSON.stringify({ phase: "开始检测", model, backend }));
      await page
        .getByRole("button", { name: backend === "wasm" ? "CPU" : "GPU", exact: true })
        .click();
      await page.getByRole("button", { name: "开始检测", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="status"]')?.textContent.includes("检测完成") ||
          document.querySelector('[role="alert"]'),
        null,
        { timeout: 120_000 }
      );
      assert.match(
        await page.getByTestId("status").innerText(),
        /检测完成/u,
        JSON.stringify(await page.locator('[role="alert"]').allTextContents())
      );
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
      const resultPath = resolve(output, `${model}-${backend}.json`);
      await (await pending).saveAs(resultPath);
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      assert.equal(result.model.id, model === "picodet-l-320" ? "pp-picodet-l-320" : model);
      assert.equal(result.model.version, model === "picodet-l-320" ? "1.0.1" : "0.1.0");
      assert.equal(result.model.source.kind, "modelscope");
      assert.equal(result.runtime.backend, backend);
      assert.equal(result.runtime.fallbacks.length, 0);
      assert(result.detections.length > 0);
      report.runs.push({
        model: result.model,
        runtime: result.runtime,
        detections: result.detections.length,
        timings: result.timings
      });
      console.log(JSON.stringify({ phase: "检测通过", model, backend }));
    }
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const before = await geometry();
    await page.locator(".detection-row").first().click();
    await page.getByTestId("selected-target").waitFor();
    assert.deepEqual(await geometry(), before);
    await page.getByRole("button", { name: "取消选择", exact: true }).click();
    assert.deepEqual(await geometry(), before);
    assert.deepEqual(await page.locator(".sample-card").allInnerTexts(), ["", "", "", ""]);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /操作说明|PaddleDetection 官方示例/u
    );
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, `demo-${width}.png`), fullPage: true });
    report.layouts.push({ width, canvas: before, selectionDoesNotShiftCanvas: true });
  }
  assert.deepEqual(report.pageErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error);
  report.lastStatus = await page
    ?.getByTestId("status")
    .innerText({ timeout: 5000 })
    .catch(() => null);
  await page?.screenshot({ path: resolve(output, "failure.png"), timeout: 5000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, "verification.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(
    JSON.stringify({
      status: report.status,
      runs: report.runs.length,
      failure: report.failure,
      output
    })
  );
}
