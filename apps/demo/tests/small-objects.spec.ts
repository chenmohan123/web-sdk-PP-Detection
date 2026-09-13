import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import type { PPDetectionResult } from "web-sdk-pp-detection";
import { expandDetails } from "./details-helpers";

async function exportedResult(page: Page) {
  await expandDetails(page, "detection-section");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), "utf8")) as PPDetectionResult;
}

test("图片增强默认关闭，开关和进度接入真实 SDK，导出保留模式", async ({ page }) => {
  await page.goto("/?fixture=1");
  const toggle = page.getByRole("checkbox", { name: "小目标增强（实验）", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator('.sample-card:has(img[src*="fruit.jpg"])').click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  expect((await exportedResult(page)).smallObjectEnhancement).toEqual({ passes: 5 });
  await toggle.uncheck();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  expect((await exportedResult(page)).smallObjectEnhancement).toBeUndefined();
});

test("390px 下开关不溢出，媒体模式不显示，切换语言保留选项", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=1");
  await page.getByRole("checkbox", { name: "小目标增强（实验）", exact: true }).check();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Small object enhancement (Labs)", exact: true })
  ).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page
    .getByRole("group", { name: "Input scene" })
    .getByRole("button", { name: "Video", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Small object enhancement (Labs)", exact: true })
  ).toHaveCount(0);
  await page
    .getByRole("group", { name: "Input scene" })
    .getByRole("button", { name: "Image", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Small object enhancement (Labs)", exact: true })
  ).toBeChecked();
});
