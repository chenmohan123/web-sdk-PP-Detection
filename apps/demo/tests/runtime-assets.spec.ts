import { expect, test, type Response } from "playwright/test";
import { TINY_MODEL_BASE64, tinyModelManifest } from "../src/fixture";

for (const source of ["huggingface", "modelscope"] as const) {
  test(`普通页面通过 ${source} 模型路径加载真实 WASM 并完成检测`, async ({ page }) => {
    const hostname = source === "modelscope" ? "www.modelscope.cn" : "huggingface.co";
    const modelUrl = `https://${hostname}/demo-runtime-test/model.onnx`;
    const manifest = {
      ...tinyModelManifest,
      variants: tinyModelManifest.variants.map((variant) => ({ ...variant, url: modelUrl }))
    };
    // 只替换外部模型传输，保留页面、SDK、Worker 与 WASM 的真实执行链。
    await page.route(`https://${hostname}/**/manifest.json*`, (route) =>
      route.fulfill({ json: manifest })
    );
    await page.route(modelUrl, (route) =>
      route.fulfill({
        body: Buffer.from(TINY_MODEL_BASE64, "base64"),
        contentType: "application/octet-stream"
      })
    );
    const wasmResponses: Response[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.endsWith(".wasm")) wasmResponses.push(response);
    });
    await page.goto("./");
    await page.getByLabel("模型来源", { exact: true }).selectOption(source);
    await page.getByRole("button", { name: "CPU", exact: true }).click();
    await page.locator(".sample-card").first().click();
    await page.getByRole("button", { name: "开始检测", exact: true }).click();

    await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20_000 });
    await expect(page.locator(".detection-row")).toHaveCount(1);
    await expect(page.locator(".error-banner")).toHaveCount(0);
    expect(wasmResponses.length).toBeGreaterThan(0);
    for (const response of wasmResponses) {
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/wasm");
      // 大型 WASM 可能被调试缓存淘汰，通过相同地址独立校验文件头。
      const asset = await page.request.get(response.url());
      expect(asset.status()).toBe(200);
      expect([...(await asset.body()).subarray(0, 4)]).toEqual([0, 97, 115, 109]);
      await asset.dispose();
    }
  });
}
