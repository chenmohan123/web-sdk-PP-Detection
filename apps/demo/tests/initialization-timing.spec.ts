import { expect, test } from "playwright/test";
import { TINY_MODEL_BASE64, tinyModelManifest } from "../src/fixture";

test("初始化总耗时包含 Demo 获取清单，运行信息来自实际 ORT", async ({ page }) => {
  await page.addInitScript(() => {
    const now = performance.now.bind(performance);
    const fetchOriginal = window.fetch.bind(window);
    let offset = 0;
    performance.now = () => now() + offset;
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args);
      const input = args[0];
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("manifest.json")) offset += 5000;
      return response;
    };
  });
  const modelUrl = "https://www.modelscope.cn/demo-timing-test/model.onnx";
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
  await page.getByTestId("sample-gallery").getByRole("button").first().click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  const total = await page
    .getByTestId("initialization-timings")
    .locator(".timing-total-row dd")
    .innerText();
  const milliseconds =
    Number.parseFloat(total.replace(/,/g, "")) * (/\bs\b/.test(total) ? 1000 : 1);
  expect(milliseconds).toBeGreaterThanOrEqual(5000);
  await expect(page.getByTestId("model-section")).toContainText("1.27.0");
  await expect(page.getByTestId("model-section")).toContainText("Chrome/");
  await expect(page.getByTestId("initialization-timings")).toContainText("网络");
});
