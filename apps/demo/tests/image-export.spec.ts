import { expandDetails } from "./details-helpers";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";

async function detectSample(page: Page): Promise<void> {
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator('.sample-card:has(img[src*="fruit.jpg"])').click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
}

async function downloadImage(page: Page, buttonName: string): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("pp-detection-result.png");
  expect(await download.failure()).toBeNull();
  return readFile(await download.path());
}

test("导出原始分辨率的完整标注 PNG，并跟随界面语言", async ({ page }) => {
  await page.goto("/?fixture=1");
  await expect(page.getByRole("button", { name: "导出标注图片", exact: true })).toBeDisabled();
  await detectSample(page);

  let chinese: Buffer | undefined;
  for (const language of ["zh", "en"]) {
    if (language === "en") await page.getByRole("button", { name: "English", exact: true }).click();
    const displayed = await page
      .getByTestId("result-canvas")
      .evaluate((canvas: HTMLCanvasElement) => ({
        width: canvas.width,
        height: canvas.height,
        png: canvas.toDataURL("image/png").split(",")[1]
      }));
    const png = await downloadImage(
      page,
      language === "zh" ? "导出标注图片" : "Export annotated image"
    );
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1400, 1249]);
    expect([displayed.width, displayed.height]).toEqual([1400, 1249]);
    expect(png.equals(Buffer.from(displayed.png, "base64"))).toBe(true);
    if (language === "zh") chinese = png;
    else expect(png.equals(chinese!)).toBe(false);
  }
});

test("没有检测到目标也可导出，清理缓存后禁止导出旧结果", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.getByRole("slider", { name: "置信度阈值", exact: true }).fill("1");
  await detectSample(page);
  await expect(page.getByTestId("detection-section")).toContainText("0 个目标");
  expect((await downloadImage(page, "导出标注图片")).length).toBeGreaterThan(1000);
  await expandDetails(page, "cache-section");
  await page.locator('[data-sdk-cache-clear="current"]').click();
  await expect(page.getByRole("button", { name: "导出标注图片", exact: true })).toBeDisabled();
});

test("PNG 编码失败时保留检测结果并允许重试", async ({ page }) => {
  await page.goto("/?fixture=1");
  await detectSample(page);
  await page.getByTestId("result-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const original = canvas.toBlob.bind(canvas);
    canvas.toBlob = (callback) => {
      canvas.toBlob = original;
      queueMicrotask(() => callback(null));
    };
  });
  await page.getByRole("button", { name: "导出标注图片", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("图片导出失败，请重试。");
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  expect((await downloadImage(page, "导出标注图片")).length).toBeGreaterThan(1000);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("换图后清除上一张图片的导出错误", async ({ page }) => {
  await page.goto("/?fixture=1");
  await detectSample(page);
  await page.getByTestId("result-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const original = canvas.toBlob.bind(canvas);
    canvas.toBlob = (callback) => {
      canvas.toBlob = original;
      queueMicrotask(() => callback(null));
    };
  });
  await page.getByRole("button", { name: "导出标注图片", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("图片导出失败，请重试。");
  await page.locator('.sample-card:has(img[src*="people.jpg"])').click();
  await expect(page.getByRole("button", { name: "导出标注图片", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
