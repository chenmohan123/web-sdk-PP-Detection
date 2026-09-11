import { expandDetails } from "./details-helpers";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import type { PPDetectionResult } from "web-sdk-pp-detection";

async function download(page: Page, name: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return readFile(await (await pending).path());
}

async function prepare(page: Page): Promise<PPDetectionResult> {
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator('.sample-card:has(img[src*="fruit.jpg"])').click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  return JSON.parse((await download(page, "导出 JSON")).toString()) as PPDetectionResult;
}

test("列表定位高亮，隐藏标签时仍显示所选目标，导出与画布一致", async ({ page }) => {
  const result = await prepare(page);
  const canvas = page.getByTestId("result-canvas");
  const pixels = () => canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const original = await pixels();
  const row = page.locator(".detection-row");
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toBeInViewport();
  expect(await pixels()).not.toBe(original);
  await page.getByRole("checkbox", { name: "显示标签", exact: true }).uncheck();
  await expect(page.getByTestId("selected-target")).toContainText("人");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("selected-target")).toContainText("person");
  const selected = await pixels();
  expect(
    (await download(page, "Export annotated image")).equals(
      Buffer.from(selected.split(",")[1], "base64")
    )
  ).toBe(true);
  expect(JSON.parse((await download(page, "Export JSON")).toString())).toEqual(result);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await page.getByRole("checkbox", { name: "显示标签", exact: true }).check();
  expect(await pixels()).toBe(original);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(row).toHaveAttribute("aria-pressed", "false");
});

test("工具栏选中提示与取消操作不改变画布的位置和尺寸", async ({ page }) => {
  await prepare(page);
  const geometry = () =>
    page.getByTestId("image-viewport").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const panel = element.closest('[data-testid="result-panel"]')!.getBoundingClientRect();
      return { top: bounds.top - panel.top, width: bounds.width, height: bounds.height };
    });
  for (const width of [1920, 1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ["zh", "en"]) {
      if (language === "en")
        await page.getByRole("button", { name: "English", exact: true }).click();
      const before = await geometry();
      await page.locator(".detection-row").click();
      await expect(page.locator(".result-toolbar").getByTestId("selected-target")).toBeVisible();
      expect(await geometry()).toEqual(before);
      await page
        .getByRole("button", {
          name: language === "zh" ? "取消选择" : "Clear selection",
          exact: true
        })
        .click();
      await expect(page.getByTestId("selected-target")).toHaveCount(0);
      expect(await geometry()).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (language === "en") await page.getByRole("button", { name: "中文", exact: true }).click();
    }
  }
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 }
]) {
  test(`缩放画布点击定位并滚动列表，留白取消选择：${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const result = await prepare(page);
    const box = result.detections[0].box;
    const canvas = page.getByTestId("result-canvas");
    const size = await canvas.evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight
    }));
    const scale = Math.min(size.width / 1400, size.height / 1249);
    await canvas.click({
      position: {
        x: (size.width - 1400 * scale) / 2 + ((box.xMin + box.xMax) / 2) * scale,
        y: (size.height - 1249 * scale) / 2 + ((box.yMin + box.yMax) / 2) * scale
      }
    });
    const row = page.locator(".detection-row");
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(row).toBeInViewport();
    await canvas.click({ position: { x: 1, y: 1 } });
    await expect(row).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false
    );
  });
}

test("筛掉目标、重新检测、换图和清理结果后不保留旧高亮", async ({ page }) => {
  await prepare(page);
  const row = page.locator(".detection-row");
  const selected = page.getByTestId("selected-target");
  await row.click();
  const filter = page.getByRole("group", { name: "筛选类别", exact: true });
  await expandDetails(page, "filter-details");
  await filter.getByRole("checkbox").uncheck();
  await expect(selected).toHaveCount(0);
  await filter.getByRole("button", { name: "显示全部", exact: true }).click();
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await row.click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await row.click();
  await page.locator('.sample-card:has(img[src*="people.jpg"])').click();
  await expect(selected).toHaveCount(0);
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await row.click();
  await expandDetails(page, "cache-section");
  await page.locator('[data-sdk-cache-clear="current"]').click();
  await expect(selected).toHaveCount(0);
});
