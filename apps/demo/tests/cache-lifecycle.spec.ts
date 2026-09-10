import { expect, test, type Page } from "playwright/test";
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

declare global {
  interface Window {
    videoFrameTest: { callbacks: Map<number, (timestamp: number) => void> };
    cameraSessionTest: { streams: MediaStream[] };
  }
}

async function prepareVideo(page: Page): Promise<() => number> {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (timestamp: number) => void>();
    let nextHandle = 0;
    window.videoFrameTest = { callbacks };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 摄像头分支通过 call 保留原型方法的 this。
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return this.srcObject === null ? Promise.resolve() : play.call(this);
    };
    HTMLVideoElement.prototype.requestVideoFrameCallback = (callback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, (timestamp) =>
        callback(timestamp, {
          width: 8,
          height: 8,
          mediaTime: timestamp / 1000,
          expectedDisplayTime: timestamp,
          presentationTime: timestamp,
          presentedFrames: handle
        })
      );
      return handle;
    };
    HTMLVideoElement.prototype.cancelVideoFrameCallback = (handle) => {
      callbacks.delete(handle);
    };
  });
  let manifestRequests = 0;
  const modelUrl = "https://www.modelscope.cn/demo-video-test/model.onnx";
  await page.route("https://www.modelscope.cn/**/manifest.json*", async (route) => {
    manifestRequests += 1;
    await route.fulfill({
      json: {
        ...tinyModelManifest,
        variants: tinyModelManifest.variants.map((variant) => ({ ...variant, url: modelUrl }))
      }
    });
  });
  await page.route(modelUrl, (route) =>
    route.fulfill({
      body: Buffer.from(TINY_MODEL_BASE64, "base64"),
      contentType: "application/octet-stream"
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    for (let index = 0; index < 4; index += 1) {
      context.fillStyle = index % 2 ? "red" : "blue";
      context.fillRect(0, 0, 8, 8);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(videoBytes)
  });
  await page.getByRole("button", { name: "播放视频", exact: true }).click();
  return () => manifestRequests;
}

async function advanceVideoFrame(page: Page, timestampMs: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.videoFrameTest.callbacks.size)).toBe(1);
  await page.evaluate((timestamp) => {
    const callbacks = window.videoFrameTest.callbacks;
    const entry = callbacks.entries().next().value;
    if (entry === undefined) throw new Error("没有待处理的视频帧");
    callbacks.delete(entry[0]);
    entry[1](timestamp);
  }, timestampMs);
  // 下一帧只会在当前检测与结果更新完成后排队，避免只等到“检测中”就断言。
  await expect
    .poll(() => page.evaluate(() => window.videoFrameTest.callbacks.size), { timeout: 20_000 })
    .toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("视频连续帧复用已加载会话并读取当前阈值", async ({ page }) => {
  const manifestRequests = await prepareVideo(page);
  await advanceVideoFrame(page, 1);
  await expect(page.locator(".detection-row strong")).toHaveText("人");
  await page.getByRole("slider", { name: "置信度阈值", exact: true }).fill("1");
  await advanceVideoFrame(page, 2);
  await expect(page.getByTestId("detection-section")).toContainText("未检测到目标");
  expect(manifestRequests()).toBe(1);
});

test("视频停止后精度与后端切换生效，清缓存和输入切换会停止旧帧", async ({ page }) => {
  const manifestRequests = await prepareVideo(page);
  await advanceVideoFrame(page, 1);
  await page.getByRole("button", { name: "停止媒体", exact: true }).click();
  expect(await page.evaluate(() => window.videoFrameTest.callbacks.size)).toBe(0);
  await page
    .getByRole("group", { name: "模型精度", exact: true })
    .getByRole("button", { name: "FP32", exact: true })
    .click();
  await page
    .getByRole("group", { name: "运行后端", exact: true })
    .getByRole("button", { name: "自动", exact: true })
    .click();
  await page.getByRole("button", { name: "播放视频", exact: true }).click();
  await advanceVideoFrame(page, 2);
  await expect(page.getByTestId("model-section")).toContainText("fp32");
  expect(manifestRequests()).toBe(2);
  await page.locator('[data-sdk-cache-clear="all"]').click();
  await expect(page.getByTestId("notice")).toContainText("缓存已清理");
  expect(await page.evaluate(() => window.videoFrameTest.callbacks.size)).toBe(0);
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("0 B");
  await page.getByRole("button", { name: "播放视频", exact: true }).click();
  await advanceVideoFrame(page, 3);
  expect(manifestRequests()).toBe(3);
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("503 B");
  await page.getByRole("button", { name: "图片", exact: true }).click();
  expect(await page.evaluate(() => window.videoFrameTest.callbacks.size)).toBe(0);
});

test("视频更换同标识自定义模型后下一帧使用新清单", async ({ page }) => {
  await prepareVideo(page);
  await advanceVideoFrame(page, 1);
  await page.getByRole("button", { name: "自定义 manifest", exact: true }).click();
  await page.getByRole("textbox", { name: "manifest JSON", exact: true }).fill(
    JSON.stringify({
      ...tinyModelManifest,
      labels: ["更新目标"],
      variants: tinyModelManifest.variants.map((variant) => ({
        ...variant,
        url: "https://www.modelscope.cn/demo-video-test/model.onnx"
      }))
    })
  );
  await page.getByRole("button", { name: "校验", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
  await advanceVideoFrame(page, 2);
  await expect(page.getByTestId("detection-section")).toContainText("更新目标");
});

test("视频切换摄像头保留新媒体流，摄像头连续帧复用且重新选择精度生效", async ({ page }) => {
  const manifestRequests = await prepareVideo(page);
  await advanceVideoFrame(page, 1);
  await page.evaluate(() => {
    window.cameraSessionTest = { streams: [] };
    navigator.mediaDevices.getUserMedia = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const context = canvas.getContext("2d")!;
      const stream = canvas.captureStream(20);
      const timer = setInterval(() => {
        if (stream.getTracks()[0]?.readyState === "ended") return clearInterval(timer);
        context.fillStyle = "red";
        context.fillRect(0, 0, 8, 8);
      }, 50);
      window.cameraSessionTest.streams.push(stream);
      return Promise.resolve(stream);
    };
  });
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => window.cameraSessionTest.streams[0]?.getTracks()[0]?.readyState)
  ).toBe("live");
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth)).toBe(8);
  await advanceVideoFrame(page, 2);
  await advanceVideoFrame(page, 3);
  expect(manifestRequests()).toBe(2);
  await page.getByRole("button", { name: "停止媒体", exact: true }).click();
  await page
    .getByRole("group", { name: "模型精度", exact: true })
    .getByRole("button", { name: "FP32", exact: true })
    .click();
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth)).toBe(8);
  await advanceVideoFrame(page, 4);
  await expect(page.getByTestId("model-section")).toContainText("fp32");
  expect(manifestRequests()).toBe(3);
});
