import { expandDetails } from "./details-helpers";
import { expect, test } from "playwright/test";

const pixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("默认使用 PicoDet 的随包清单和 ModelScope 来源", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("检测模型", { exact: true })).toHaveValue("picodet-l-320");
  await expect(page.getByLabel("模型来源", { exact: true })).toHaveValue("modelscope");
  await expect(page.getByLabel("模型来源").locator("option")).toHaveText([
    "ModelScope",
    "Hugging Face"
  ]);

  const contract = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import("../src/model-sources");
    const picoDet = module.modelOption("picodet-l-320");
    const ppyoloe = module.modelOption("ppyoloe-plus-s-640");
    return {
      defaultModel: module.DEFAULT_MODEL,
      picoDetDefaultSource: module.defaultSource(picoDet),
      picoDetIdentity: picoDet.manifest.model,
      picoDetManifestPath: picoDet.manifestPath,
      picoDetSources: module.sourceOptions(picoDet).map((option) => option.key),
      ppyoloeDefaultSource: module.defaultSource(ppyoloe),
      ppyoloeIdentity: ppyoloe.manifest.model,
      ppyoloeManifestPath: ppyoloe.manifestPath,
      ppyoloeSources: module.sourceOptions(ppyoloe).map((option) => option.key)
    };
  }, "/src/model-sources.ts");

  expect(contract).toEqual({
    defaultModel: "picodet-l-320",
    picoDetDefaultSource: "modelscope",
    picoDetIdentity: { id: "pp-picodet-l-320", version: "1.0.1" },
    picoDetManifestPath: "models/pp-detection/manifest.json",
    picoDetSources: ["modelscope", "huggingface"],
    ppyoloeDefaultSource: "modelscope",
    ppyoloeIdentity: { id: "ppyoloe-plus-s-640", version: "0.1.0" },
    ppyoloeManifestPath: "models/ppyoloe-plus-s-640/manifest.json",
    ppyoloeSources: ["modelscope", "huggingface"]
  });
  await page.getByLabel("检测模型", { exact: true }).selectOption("ppyoloe-plus-s-640");
  await expect(page.getByLabel("模型来源", { exact: true })).toHaveValue("modelscope");
  await page.getByLabel("模型来源", { exact: true }).selectOption("huggingface");
  await expect(page.getByLabel("模型来源", { exact: true })).toHaveValue("huggingface");
  await page.getByLabel("检测模型", { exact: true }).selectOption("picodet-l-320");
  await expect(page.getByLabel("模型来源", { exact: true })).toHaveValue("modelscope");
  await page.getByLabel("模型来源", { exact: true }).selectOption("huggingface");
  await expect(page.getByLabel("模型来源", { exact: true })).toHaveValue("huggingface");
  await page.reload();
  await expect(page.getByLabel("模型来源", { exact: true })).toHaveValue("modelscope");
});

test("图片、摄像头和视频输入场景均可切换", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const cameraCalls: MediaStreamConstraints[] = [];
    Object.defineProperty(window, "__cameraCalls", {
      configurable: true,
      value: cameraCalls
    });
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const stream = canvas.captureStream(1);
    Object.defineProperty(stream.getVideoTracks()[0], "getSettings", {
      value: () => ({ deviceId: "rear" })
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: (constraints: MediaStreamConstraints) => {
          cameraCalls.push(constraints);
          return Promise.resolve(stream);
        },
        enumerateDevices: () =>
          Promise.resolve([
            { deviceId: "front", kind: "videoinput", label: "前置摄像头", groupId: "group-1" },
            { deviceId: "rear", kind: "videoinput", label: "后置摄像头", groupId: "group-2" }
          ])
      }
    });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.goto("/?fixture=1");
  const inputGroup = page.getByRole("group", { name: "输入场景" });
  await expect(inputGroup.getByRole("button", { name: "图片" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(inputGroup.getByRole("button", { name: "摄像头" })).toBeVisible();
  await expect(inputGroup.getByRole("button", { name: "视频" })).toBeVisible();
  await inputGroup.getByRole("button", { name: "摄像头" }).click();
  await expect(page.getByLabel("摄像头设备")).toBeVisible();
  await expect(page.getByLabel("摄像头设备").locator("option")).toHaveCount(3);
  await page.getByLabel("摄像头设备").selectOption("rear");
  await page.getByRole("button", { name: "启动摄像头" }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __cameraCalls: MediaStreamConstraints[] }).__cameraCalls
        ),
      { timeout: 5_000 }
    )
    .toContainEqual({ audio: false, video: { deviceId: { exact: "rear" } } });
  const cameraCalls = await page.evaluate(
    () => (window as unknown as { __cameraCalls: MediaStreamConstraints[] }).__cameraCalls
  );
  expect(cameraCalls.at(-1)).toEqual({
    audio: false,
    video: { deviceId: { exact: "rear" } }
  });
  await expect(page.locator("video")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "视频" }).click();
  await expect(page.getByTestId("result-panel").getByText("选择一个视频开始播放")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("RIFF\x00\x00\x00\x00WEBM", "binary")
  });
  await expect(
    page.getByTestId("controls").getByText("sample.webm", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "播放视频" })).toBeVisible();
});

test("normalizes active class threshold configuration", async ({ page }) => {
  await page.goto("/?fixture=1");
  const result = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import("../src/class-thresholds");
    const updatedPrototype = module.setClassThresholdValue({}, "__proto__", "0.4");
    return {
      defaults: module.DEFAULT_CLASS_LABELS,
      prototypeValues: ["constructor", "toString", "__proto__"].map((label) =>
        module.classThresholdValue({}, label)
      ),
      selected: module.selectActiveClassThresholds(["person", "person", "car"], {
        person: 0.4,
        stale: 0.2,
        car: 0.6
      }),
      prototypeLabels: module.selectActiveClassThresholds(
        ["constructor", "toString", "__proto__"],
        {}
      ),
      updatedPrototype: {
        own: Object.hasOwn(updatedPrototype, "__proto__"),
        selected: module.classThresholdValue(
          module.selectActiveClassThresholds(["__proto__"], updatedPrototype),
          "__proto__"
        ),
        value: module.classThresholdValue(updatedPrototype, "__proto__")
      }
    };
  }, "/src/class-thresholds.ts");

  expect(result.defaults).toContain("person");
  expect(result.defaults).toContain("car");
  expect(result.defaults).not.toContain("formula");
  expect(result.defaults).not.toContain("table");
  expect(result.prototypeValues).toEqual(["", "", ""]);
  expect(result.selected).toEqual({ person: 0.4, car: 0.6 });
  expect(result.prototypeLabels).toEqual({});
  expect(result.updatedPrototype).toEqual({ own: true, selected: 0.4, value: 0.4 });
});

test("edits, applies, localizes, and clears class thresholds", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.getByText("类别阈值", { exact: true }).click();
  const personThreshold = page.getByRole("spinbutton", { name: "类别阈值 人", exact: true });
  await expect(personThreshold).toBeVisible();
  await personThreshold.fill("0");
  await page.getByRole("slider", { name: "置信度阈值" }).fill("1");
  await page.locator('input[type="file"]').setInputFiles({
    name: "threshold.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expect(page.locator(".detection-row strong")).toHaveText("人");

  await page.getByRole("button", { name: "清空类别阈值" }).click();
  await expect(personThreshold).toHaveValue("");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Class thresholds", { exact: true })).toBeVisible();
});

test("maps SDK progress events to honest model status text states", async ({ page }) => {
  await page.goto("/?fixture=1");
  const states = await page.evaluate(async (moduleUrl) => {
    type EvaluatedState =
      | { readonly status: "downloading"; readonly percentage?: number }
      | { readonly status: "loading" };
    const { modelProgressState } = (await import(moduleUrl)) as {
      readonly modelProgressState: (event: {
        readonly phase: string;
        readonly status: string;
        readonly loadedBytes?: number;
        readonly totalBytes?: number;
      }) => EvaluatedState | undefined;
    };
    return [
      modelProgressState({ phase: "model", status: "start" }),
      modelProgressState({ phase: "model", status: "progress", loadedBytes: 56 }),
      modelProgressState({
        phase: "model",
        status: "progress",
        loadedBytes: 56,
        totalBytes: 100
      }),
      modelProgressState({ phase: "session", status: "start" }),
      modelProgressState({ phase: "ready", status: "complete" })
    ];
  }, "/src/model-progress.ts");

  expect(states).toEqual([
    { status: "loading" },
    { status: "downloading" },
    { percentage: 56, status: "downloading" },
    { status: "loading" },
    undefined
  ]);
});

test("keeps manual choices strict and uses only validated default pairs", async ({ page }) => {
  await page.goto("/?fixture=1");
  const behavior = await page.evaluate(
    async ({ preferencesUrl, messagesUrl }) => {
      const preferences = (await import(
        preferencesUrl
      )) as unknown as typeof import("../src/execution-preferences");
      const messages = (await import(
        messagesUrl
      )) as unknown as typeof import("../src/runtime-messages");
      return {
        autoFallback: preferences.allowFallbackForSelection("auto", "auto"),
        backendFallback: preferences.allowFallbackForSelection("webgpu", "auto"),
        precisionFallback: preferences.allowFallbackForSelection("auto", "fp32"),
        gpuFp16: preferences.supportsCombination("webgpu", "fp16"),
        gpuFp32: preferences.supportsCombination("webgpu", "fp32"),
        wasmFp16: preferences.supportsCombination("wasm", "fp16"),
        wasmFp32: preferences.supportsCombination("wasm", "fp32"),
        gpuCorrection: preferences.precisionForBackend("webgpu", "fp32"),
        wasmCorrection: preferences.precisionForBackend("wasm", "fp16"),
        runtimeError: messages.formatRuntimeError({
          details: { causeMessage: "unsupported WebGPU operator" },
          message: "ONNX session-create failed for webgpu"
        }),
        fallbackCause: messages.formatFallbackCause({
          cause: { message: "adapter allocation failed" },
          message: "ONNX session-create failed for webgpu"
        })
      };
    },
    {
      preferencesUrl: "/src/execution-preferences.ts",
      messagesUrl: "/src/runtime-messages.ts"
    }
  );

  expect(behavior).toEqual({
    autoFallback: true,
    backendFallback: false,
    precisionFallback: true,
    gpuFp16: true,
    gpuFp32: true,
    wasmFp16: true,
    wasmFp32: true,
    gpuCorrection: "fp32",
    wasmCorrection: "fp16",
    runtimeError: "ONNX session-create failed for webgpu: unsupported WebGPU operator",
    fallbackCause: "adapter allocation failed"
  });
});

test("reports loading before detecting for an in-memory model", async ({ page }) => {
  await page.route("**/ort/*.wasm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("/?fixture=1");
  await page.locator('input[type="file"]').setInputFiles({
    name: "status.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await page.getByTestId("status").evaluate((target) => {
    const history: string[] = [];
    Object.defineProperty(window, "__statusHistory", { configurable: true, value: history });
    const record = (): void => {
      const snapshot = target.cloneNode(true) as HTMLElement;
      snapshot.querySelector(".status-hint")?.remove();
      const text = snapshot.textContent?.trim();
      if (text !== undefined && history.at(-1) !== text) history.push(text);
    };
    new MutationObserver(record).observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    record();
  });

  const wasmRequest = page.waitForRequest(
    (request) => request.url().includes("/ort/") && request.url().endsWith(".wasm")
  );
  await page.getByRole("button", { name: "开始检测" }).click();
  await wasmRequest;
  await expect(page.getByLabel("检测模型")).toBeEnabled();
  await expect(page.getByLabel("模型来源")).toBeEnabled();
  await expect(page.getByTestId("status")).toContainText("模型加载中");
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expect(page.getByLabel("模型来源")).toBeEnabled();

  const history = await page.evaluate(
    () =>
      (window as typeof window & { readonly __statusHistory: readonly string[] }).__statusHistory
  );
  const loadingIndex = history.indexOf("模型加载中");
  const detectingIndex = history.indexOf("检测中");
  const successIndex = history.indexOf("检测完成");
  expect(loadingIndex).toBeGreaterThanOrEqual(0);
  expect(detectingIndex).toBeGreaterThan(loadingIndex);
  expect(successIndex).toBeGreaterThan(detectingIndex);
  expect(history.some((text) => text.includes("模型下载中") || text.includes("0%"))).toBe(false);
});

test("starts in Chinese and exposes the complete detection workflow", async ({
  page
}, testInfo) => {
  await page.goto("/?fixture=1");

  const fixtureOrtModule = await page.request.get("/ort/ort-wasm-simd-threaded.jsep.mjs");
  expect(fixtureOrtModule.status()).toBe(200);
  expect(fixtureOrtModule.headers()["content-type"]).toContain("text/javascript");

  await expect(page.getByRole("heading", { name: "PP-Detection" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/chenmohan123/web-sdk-PP-Detection"
  );
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("rel", "noreferrer");
  await expect(page.getByText("SDK 0.3.1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "English", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "运行后端" })).toBeVisible();
  await expect(page.getByRole("group", { name: "模型精度" })).toBeVisible();
  await page.getByRole("group", { name: "运行后端" }).getByRole("button", { name: "CPU" }).click();
  await expect(
    page.getByRole("group", { name: "运行后端" }).getByRole("button", { name: "CPU" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "模型精度" }).getByRole("button", { name: "FP32" }).click();
  await expect(page.getByRole("button", { name: "选择图片" })).toBeVisible();
  await expect(page.getByText("模型信息")).toBeVisible();
  await expect(page.getByRole("button", { name: "多边形" })).toHaveCount(0);

  const performance = page.getByTestId("performance-section");
  const initialization = performance.getByTestId("initialization-timings");
  const detection = performance.getByTestId("detection-timings");
  await expect(initialization).toBeHidden();
  await expect(detection).toBeHidden();
  await expandDetails(page, "performance-details");
  await expect(initialization).toBeVisible();
  await expect(detection).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await expect(page.getByRole("button", { name: "开始检测" })).toBeEnabled();
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expect(page.getByTestId("result-canvas")).toBeVisible();
  await expect(
    page.getByTestId("result-panel").getByRole("heading", { name: "检测结果" })
  ).toBeVisible();
  await expect(initialization.getByText("初始化", { exact: true })).toBeVisible();
  await expect(detection.getByText("本次检测", { exact: true })).toBeVisible();
  await expect(initialization.getByText("初始化总耗时", { exact: true })).toBeVisible();
  await expect(detection.getByText("端到端耗时", { exact: true })).toBeVisible();
  await expect(detection.getByText("图片解码", { exact: true })).toBeVisible();
  await expect(detection.getByText("模型推理", { exact: true })).toBeVisible();
  await expect(page.getByTestId("initialization-policy")).toHaveCount(0);
  expect(
    await performance.evaluate((section: HTMLElement) => {
      const initialization = section.querySelector('[data-testid="initialization-timings"]');
      const detection = section.querySelector('[data-testid="detection-timings"]');
      return Boolean(
        initialization &&
        detection &&
        initialization.compareDocumentPosition(detection) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    })
  ).toBe(true);
  await expect(page.getByTestId("timing-total")).toContainText("ms");
  await expect(page.getByTestId("model-name")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
  await expandDetails(page, "cache-section");
  await expect(page.getByRole("button", { name: "清理当前模型缓存" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "清理全部本 SDK 缓存" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("pp-detection-result.json");
  const canvasPixels = await page
    .getByTestId("result-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let index = 0; index < pixels.length; index += 4)
        sum += pixels[index] + pixels[index + 1] + pixels[index + 2];
      return sum;
    });
  expect(canvasPixels).toBeGreaterThan(0);
  await page.getByRole("button", { name: "清理当前模型缓存" }).click();
  await expect(page.getByTestId("notice")).toContainText("缓存已清理");
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
});

test("enforces the selected manifest model matrix in controls", async ({ page }) => {
  await page.goto("/?fixture=1");
  const backend = page.getByRole("group", { name: "运行后端" });
  const precision = page.getByRole("group", { name: "模型精度" });

  await precision.getByRole("button", { name: "FP32" }).click();
  await backend.getByRole("button", { name: "GPU" }).click();
  await expect(precision.getByRole("button", { name: "FP32" })).toBeEnabled();
  await expect(precision.getByRole("button", { name: "FP32" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("notice")).toHaveCount(0);

  await backend.getByRole("button", { name: "自动" }).click();
  await backend.getByRole("button", { name: "CPU" }).click();

  await expect(precision.getByRole("button", { name: "FP16" })).toBeDisabled();
  await expect(precision.getByRole("button", { name: "FP16" })).toHaveAttribute("title", /FP16/);
  await expect(precision.getByRole("button", { name: "FP32" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "cpu-fp16.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });

  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expandDetails(page, "model-section");
  await expect(page.getByText("wasm", { exact: true })).toBeVisible();
  await expect(page.getByText("fp32", { exact: true })).toBeVisible();
});

test("shows local PaddleDetection sample images and only previews a selected sample", async ({
  page
}) => {
  await page.goto("/?fixture=1");
  await expect(page.getByTestId("sample-gallery")).toBeVisible();
  expect(
    await page.getByTestId("demo-shell").evaluate((panel: HTMLElement) => {
      const canvas = panel.querySelector(".canvas-wrap");
      const samples = panel.querySelector('[data-testid="sample-gallery"]');
      return Boolean(
        canvas &&
        samples &&
        canvas.compareDocumentPosition(samples) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    })
  ).toBe(true);
  await expect(page.getByRole("button", { name: /人物/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /人物/ }).first().click();
  await expect(page.getByTestId("status")).toContainText("准备就绪");
  await expect(page.getByRole("button", { name: "开始检测" })).toBeEnabled();
});

test("检测列表优先展示，详情默认折叠且支持键盘展开", async ({ page }) => {
  await page.goto("/?fixture=1");
  await expect(page.getByTestId("detection-section")).toContainText("检测后在这里查看目标");
  for (const testId of ["performance-details", "model-section", "cache-section"]) {
    const details = page.getByTestId(testId);
    await expect(details).not.toHaveAttribute("open");
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open");
  }
  await page.locator(".sample-card").first().click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成");
  await expect(page.getByTestId("summary-total")).toContainText("ms");
  await expect(page.getByTestId("summary-inference")).toContainText("ms");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const bounds = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const preview = bounds('[data-testid="result-panel"]');
      const results = bounds('[data-testid="detection-section"]');
      const first = bounds(".detection-row");
      const samples = bounds('[data-testid="sample-gallery"]');
      const performance = bounds('[data-testid="performance-section"]');
      return {
        previewTop: preview.top,
        previewBottom: preview.bottom,
        resultsTop: results.top,
        resultsBottom: results.bottom,
        firstTop: first.top,
        firstBottom: first.bottom,
        samplesTop: samples.top,
        performanceTop: performance.top
      };
    });
    expect(layout.firstTop).toBeGreaterThan(layout.resultsTop);
    expect(layout.firstBottom).toBeLessThanOrEqual(layout.resultsTop + 400);
    expect(layout.resultsBottom).toBeLessThanOrEqual(layout.performanceTop);
    if (width >= 1200) {
      expect(layout.resultsTop).toBe(layout.previewTop);
      expect(layout.firstBottom).toBeLessThan(900);
    } else {
      expect(layout.resultsTop - layout.previewBottom).toBeGreaterThanOrEqual(0);
      expect(layout.resultsTop - layout.previewBottom).toBeLessThanOrEqual(1);
      expect(layout.samplesTop).toBeGreaterThan(layout.resultsBottom);
    }
  }
});

test("switches language, validates custom model input, and cancels", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PP-Detection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run detection" })).toBeVisible();

  await expect(page.getByRole("checkbox", { name: "Show labels", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Custom manifest" }).click();
  await expect(page.getByRole("dialog", { name: "Custom model" })).toBeVisible();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByRole("alert")).toContainText(/manifest/i);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cancel.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await page.getByRole("button", { name: "Run detection" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("status")).toContainText("Ready");
});

test("stacks the result workflow on a narrow viewport without horizontal overflow", async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=1");
  await expect(page.getByTestId("demo-shell")).toBeVisible();
  await page.getByText("类别阈值", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "类别阈值 人", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    containers: [...document.querySelectorAll<HTMLElement>("html, body, body *")]
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => ({
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        tagName: element.tagName
      })),
    clientWidth: document.documentElement.clientWidth,
    elements: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          bounds: {
            left: Math.round(bounds.left * 100) / 100,
            right: Math.round(bounds.right * 100) / 100,
            width: Math.round(bounds.width * 100) / 100
          },
          className: element.className,
          tagName: element.tagName
        };
      })
      .filter(({ bounds }) => bounds.left < 0 || bounds.right > innerWidth),
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth
  }));
  await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true });
  expect(overflow, JSON.stringify(overflow, null, 2)).toMatchObject({
    clientWidth: 390,
    elements: [],
    scrollWidth: 390,
    viewportWidth: 390
  });
  await expect(page.getByTestId("controls")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toBeVisible();
  await expect(page.getByTestId("details-panel")).toBeVisible();

  const fallbackCause = await page.evaluate((cause) => {
    const slot = document.querySelector<HTMLElement>('[data-testid="fallback-slot"]');
    if (slot === null) throw new Error("Fallback slot is missing");
    slot.innerHTML = `<section class="detail-section"><div class="fallback-row"><small>${cause}</small></div></section>`;
    const element = slot.querySelector<HTMLElement>(".fallback-row small");
    if (element === null) throw new Error("Fallback cause is missing");
    return {
      clientWidth: element.clientWidth,
      overflowWrap: getComputedStyle(element).overflowWrap,
      scrollWidth: element.scrollWidth
    };
  }, "adapterallocationfailed".repeat(30));
  expect(fallbackCause.scrollWidth).toBeLessThanOrEqual(fallbackCause.clientWidth);
  expect(fallbackCause.overflowWrap).toBe("anywhere");
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
]) {
  test(`has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/?fixture=1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  });
}
