import { expandDetails } from "./details-helpers";
import { expect, test } from "playwright/test";

test("清理缓存后撤下检测框并恢复原图", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.getByTestId("sample-gallery").getByRole("button").first().click();
  const differentChannels = () =>
    page.evaluate(() => {
      const source = document.querySelector<HTMLImageElement>(".source-image")!;
      const result = document.querySelector<HTMLCanvasElement>('[data-testid="result-canvas"]')!;
      const original = document.createElement("canvas");
      original.width = result.width;
      original.height = result.height;
      original.getContext("2d")!.drawImage(source, 0, 0, original.width, original.height);
      const actual = result.getContext("2d")!.getImageData(0, 0, result.width, result.height).data;
      const expected = original
        .getContext("2d")!
        .getImageData(0, 0, original.width, original.height).data;
      let count = 0;
      for (let index = 0; index < actual.length; index++)
        if (actual[index] !== expected[index]) count++;
      return count;
    });
  for (const scope of ["current", "all"]) {
    await page.getByRole("button", { name: "开始检测", exact: true }).click();
    await expect(page.getByTestId("status")).toHaveClass(/success/);
    expect(await differentChannels()).toBeGreaterThan(0);
    await expandDetails(page, "cache-section");
    await page.locator(`[data-sdk-cache-clear="${scope}"]`).click();
    await expect(page.getByText("缓存已清理", { exact: true })).toBeVisible();
    await expect.poll(differentChannels).toBe(0);
    await expect(page.getByTestId("detection-section")).toContainText("0 个目标");
  }
});
