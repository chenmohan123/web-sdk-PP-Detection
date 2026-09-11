import { expandDetails } from "./details-helpers";
import { expect, test, type Page } from "playwright/test";

const MODEL_SELECT = "检测模型";
const SOURCE_SELECT = "模型来源";

async function selectSample(page: Page): Promise<void> {
  await page.getByTestId("sample-gallery").getByRole("button").first().click();
}

async function runFixture(page: Page): Promise<void> {
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await selectSample(page);
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20_000 });
}

test("默认选择 PicoDet 和 ModelScope，来源只提供两个模型 Hub", async ({ page }) => {
  await page.goto("/?fixture=1");

  await expect(page.getByLabel(MODEL_SELECT, { exact: true })).toHaveValue("picodet-l-320");
  await expect(page.getByLabel(SOURCE_SELECT, { exact: true })).toHaveValue("modelscope");
  await expect(page.getByLabel(SOURCE_SELECT).locator("option")).toHaveText([
    "ModelScope",
    "Hugging Face"
  ]);
  await expect(page.getByTestId("selected-model-summary")).toHaveCount(0);
});

test("选择 PP-YOLOE 后按稳定模型加载，并清除旧模型结果", async ({ page }) => {
  await page.goto("/?fixture=1");
  await runFixture(page);
  await expect(page.getByTestId("model-name")).toHaveText("pp-picodet-l-320");

  await page.getByLabel(MODEL_SELECT, { exact: true }).selectOption("ppyoloe-plus-s-640");

  await expect(page.getByLabel(SOURCE_SELECT, { exact: true })).toHaveValue("modelscope");
  await expect(page.getByLabel(SOURCE_SELECT).locator("option")).toHaveText([
    "ModelScope",
    "Hugging Face"
  ]);
  await expect(page.locator(".detection-row")).toHaveCount(0);
  await expect(page.getByTestId("model-name")).toHaveText("-");
  await expect(page.getByLabel(MODEL_SELECT).locator("option:checked")).toHaveText(
    "PP-YOLOE+ S 640"
  );
  await page
    .getByRole("group", { name: "运行后端", exact: true })
    .getByRole("button", { name: "自动", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "模型精度", exact: true }).getByRole("button", {
      name: "FP16",
      exact: true
    })
  ).toBeDisabled();
  await runFixture(page);
  await expect(page.getByTestId("model-name")).toHaveText("ppyoloe-plus-s-640");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("加载期间切换模型会取消旧任务，迟到结果不会污染新模型", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let wasmWaiting = false;
  await page.route("**/ort/*.wasm", async (route) => {
    if (!wasmWaiting) {
      wasmWaiting = true;
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await selectSample(page);
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect.poll(() => wasmWaiting).toBe(true);

  const modelSelect = page.getByLabel(MODEL_SELECT, { exact: true });
  await expect(modelSelect).toBeEnabled();
  await modelSelect.selectOption("ppyoloe-plus-s-640");
  release();

  await expect(modelSelect).toHaveValue("ppyoloe-plus-s-640");
  await expect(page.getByTestId("status")).toContainText("准备就绪");
  await expect(page.locator(".detection-row")).toHaveCount(0);
  await expect(page.getByTestId("model-name")).toHaveText("-");
});

test("当前模型缓存按所选 manifest 的 id 和 version 隔离", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("web-sdk-pp-detection-models-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("models", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("打开测试缓存失败"));
    });
    const transaction = database.transaction("models", "readwrite");
    const store = transaction.objectStore("models");
    for (const [id, version, size] of [
      ["pp-picodet-l-320", "1.0.1", 503],
      ["ppyoloe-plus-s-640", "0.1.0", 607]
    ] as const) {
      const key = JSON.stringify([
        "web-sdk-pp-detection:cache-v1",
        id,
        version,
        "fp32",
        "fixture-revision",
        "0".repeat(64)
      ]);
      store.put({ key, bytes: new ArrayBuffer(size), size });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("写入测试缓存失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("写入测试缓存中止"));
    });
    database.close();
  });
  await page.reload();
  await expect(page.locator('[data-sdk-cache-usage="current"]')).toContainText("503 B");
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("1.1 KB");

  await page.getByLabel(MODEL_SELECT, { exact: true }).selectOption("ppyoloe-plus-s-640");
  await expect(page.locator('[data-sdk-cache-usage="current"]')).toContainText("607 B");
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("1.1 KB");

  await expandDetails(page, "cache-section");
  await page.locator('[data-sdk-cache-clear="current"]').click();
  await expect(page.locator('[data-sdk-cache-usage="current"]')).toContainText("0 B");
  await expect(page.locator('[data-sdk-cache-usage="all"]')).toContainText("503 B");
});

test("显式选择的 PP-YOLOE 来源失败时不会请求其他来源", async ({ page }) => {
  await page.goto("/");
  const contract = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import("../src/model-sources");
    const option = module.modelOption("ppyoloe-plus-s-640");
    return option.manifest.variants[0].sources.map((source) => ({
      kind: source.kind,
      url: source.downloadUrl
    }));
  }, "/src/model-sources.ts");
  expect(contract.length).toBeGreaterThan(0);
  const selected = contract[0];
  const requests: string[] = [];
  for (const source of contract) {
    await page.route(source.url, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 503, body: "unavailable" });
    });
  }

  await page.getByLabel(MODEL_SELECT, { exact: true }).selectOption("ppyoloe-plus-s-640");
  await page.getByLabel(SOURCE_SELECT, { exact: true }).selectOption(selected.kind);
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await selectSample(page);
  await page.getByRole("button", { name: "开始检测", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(/MODEL_SOURCE_UNAVAILABLE|模型来源/);
  expect(requests).toEqual([selected.url]);
  await expect(page.locator(".detection-row")).toHaveCount(0);
});

test("390px 视口下模型和来源选择不产生横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=1");
  await page.getByLabel(MODEL_SELECT, { exact: true }).selectOption("ppyoloe-plus-s-640");

  expect(
    await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth
    }))
  ).toEqual({ clientWidth: 390, scrollWidth: 390, viewportWidth: 390 });
  await expect(page.getByLabel(MODEL_SELECT, { exact: true })).toBeVisible();
  await expect(page.getByLabel(SOURCE_SELECT, { exact: true })).toBeVisible();
  await expect(page.getByTestId("selected-model-summary")).toHaveCount(0);
});
