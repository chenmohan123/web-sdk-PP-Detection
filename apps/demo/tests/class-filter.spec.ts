import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";

async function detectSample(page: Page): Promise<void> {
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator('.sample-card:has(img[src*="fruit.jpg"])').click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
}

async function download(page: Page, button: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  return readFile(await (await pending).path());
}

test("筛选立即同步画布、数量和图片导出，恢复时无需重新检测", async ({ page }) => {
  await page.goto("/?fixture=1");
  await detectSample(page);
  const filter = page.getByRole("group", { name: "筛选类别", exact: true });
  const person = filter.getByRole("checkbox", { name: "人 (1)", exact: true });
  await expect(person).toBeChecked();
  const canvas = page.getByTestId("result-canvas");
  const allPixels = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const allJson = await download(page, "导出 JSON");

  await person.uncheck();
  await expect(page.locator(".detection-row")).toHaveCount(0);
  await expect(page.locator(".count-badge")).toHaveText("0 / 1 个目标");
  await expect(page.getByTestId("detection-section")).toContainText("当前筛选下无目标");
  await expect(person).not.toBeChecked();
  const filteredPixels = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  expect(filteredPixels).not.toBe(allPixels);
  const originalPixels = await page.locator(".source-image").evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return canvas.toDataURL();
  });
  expect(filteredPixels).toBe(originalPixels);
  expect(
    (await download(page, "导出标注图片")).equals(
      Buffer.from(filteredPixels.split(",")[1], "base64")
    )
  ).toBe(true);

  await page.getByRole("button", { name: "English", exact: true }).click();
  const english = page.getByRole("group", { name: "Filter classes", exact: true });
  await expect(
    english.getByRole("checkbox", { name: "person (1)", exact: true })
  ).not.toBeChecked();
  await english.getByRole("button", { name: "Show all", exact: true }).click();
  await expect(page.locator(".detection-row strong")).toHaveText("person");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  expect(await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(allPixels);
  expect((await download(page, "导出 JSON")).equals(allJson)).toBe(true);
});

test("换图和清理缓存后重置筛选，零检测不误报为筛选无匹配", async ({ page }) => {
  await page.goto("/?fixture=1");
  await detectSample(page);
  const filter = page.getByRole("group", { name: "筛选类别", exact: true });
  await filter.getByRole("checkbox").uncheck();
  await detectSample(page);
  await expect(filter.getByRole("checkbox")).toBeChecked();
  await filter.getByRole("checkbox").uncheck();
  await page.locator('[data-sdk-cache-clear="current"]').click();
  await expect(filter).toHaveCount(0);
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(filter.getByRole("checkbox")).toBeChecked();
  await page.getByRole("slider", { name: "置信度阈值", exact: true }).fill("1");
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  await expect(page.getByTestId("detection-section")).toContainText("未检测到目标");
  await expect(page.getByTestId("detection-section")).not.toContainText("当前筛选下无目标");
});
