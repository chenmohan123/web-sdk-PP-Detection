import { expect, test, type Response } from "playwright/test";

for (const source of ["huggingface", "modelscope"] as const) {
  test(`fixture 通过 ${source} 来源选择加载真实 WASM 并完成检测`, async ({ page }) => {
    const wasmResponses: Response[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.endsWith(".wasm")) wasmResponses.push(response);
    });
    await page.goto("./?fixture=1");
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
