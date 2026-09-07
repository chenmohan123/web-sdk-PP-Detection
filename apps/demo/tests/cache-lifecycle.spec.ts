import { expect, test } from "playwright/test";
import { TINY_MODEL_BASE64, tinyModelManifest } from "../src/fixture";

test("下载中清理当前模型，旧加载不能回填，清理后可重新检测", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let downloading = false;
  let first = true;
  const modelUrl = "https://www.modelscope.cn/demo-cache-test/model.onnx";
  await page.route("https://www.modelscope.cn/**/manifest.json*", (route) =>
    route.fulfill({
      json: {
        ...tinyModelManifest,
        variants: tinyModelManifest.variants.map((variant) => ({ ...variant, url: modelUrl }))
      }
    })
  );
  await page.route(modelUrl, async (route) => {
    if (first) {
      first = false;
      downloading = true;
      await gate;
    }
    await route
      .fulfill({
        body: Buffer.from(TINY_MODEL_BASE64, "base64"),
        contentType: "application/octet-stream"
      })
      .catch(() => undefined);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator(".sample-card").first().click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect.poll(() => downloading).toBe(true);
  await page.locator('[data-sdk-cache-clear="current"]').click();
  release();
  await expect(page.locator('[data-sdk-cache-clear="current"]')).toBeEnabled();
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("0 B");
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20_000 });
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("503 B");
  await page.locator('[data-sdk-cache-clear="all"]').click();
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("0 B");
});

test("清理错误显示后可以重试，快速双击只执行一轮清理", async ({ page }) => {
  const modelUrl = "https://www.modelscope.cn/demo-cache-test/model.onnx";
  await page.route("https://www.modelscope.cn/**/manifest.json*", (route) =>
    route.fulfill({
      json: {
        ...tinyModelManifest,
        variants: tinyModelManifest.variants.map((variant) => ({ ...variant, url: modelUrl }))
      }
    })
  );
  await page.route(modelUrl, (route) =>
    route.fulfill({
      body: Buffer.from(TINY_MODEL_BASE64, "base64"),
      contentType: "application/octet-stream"
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator(".sample-card").first().click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20_000 });
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 下方通过 call 保留原型方法的 this。
    const remove = IDBObjectStore.prototype.delete;
    let failOnce = true;
    IDBObjectStore.prototype.delete = function (key) {
      if (failOnce) {
        failOnce = false;
        throw new Error("测试缓存事务异常");
      }
      return remove.call(this, key);
    };
  });
  await page.locator('[data-sdk-cache-clear="all"]').click();
  await expect(page.getByRole("alert")).toContainText("测试缓存事务异常");
  await expect(page.locator('[data-sdk-cache-clear="all"]')).toBeEnabled();
  await page.locator('[data-sdk-cache-clear="all"]').evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("0 B");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("清理后迟到的视频 play 不会重启帧调度", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { waiting: false, scheduled: 0, release: () => {} };
    Object.assign(window, { videoCacheTest: state });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { get: () => 2 });
    HTMLMediaElement.prototype.play = () => {
      state.waiting = true;
      return new Promise<void>((resolve) => {
        state.release = resolve;
      });
    };
    HTMLVideoElement.prototype.requestVideoFrameCallback = () => ++state.scheduled;
  });
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("RIFF0000WEBM")
  });
  await page.getByRole("button", { name: "播放视频", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { videoCacheTest: { waiting: boolean } }).videoCacheTest.waiting
      )
    )
    .toBe(true);
  await page.locator('[data-sdk-cache-clear="all"]').click();
  await page.evaluate(() =>
    (window as unknown as { videoCacheTest: { release(): void } }).videoCacheTest.release()
  );
  await expect(page.getByTestId("notice")).toContainText("缓存已清理");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { videoCacheTest: { scheduled: number } }).videoCacheTest.scheduled
    )
  ).toBe(0);
});
