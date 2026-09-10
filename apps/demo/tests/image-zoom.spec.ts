import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import type { PPDetectionResult } from "web-sdk-pp-detection";

async function prepare(page: Page): Promise<void> {
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator('.sample-card:has(img[src*="fruit.jpg"])').click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
}

async function download(page: Page, name: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return readFile(await (await pending).path());
}

test("缩放与拖动不改变完整标注导出，拖动不误选目标，复位还原视图", async ({ page }) => {
  await prepare(page);
  const canvas = page.getByTestId("result-canvas");
  const original = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const json = await download(page, "导出 JSON");
  const size = await canvas.boundingBox();
  await page.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("125%");
  expect((await canvas.boundingBox())!.width).toBeCloseTo(size!.width * 1.25, 0);
  // 再放大到图片宽高均超过视口，确保两个方向都允许拖动。
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "放大图片", exact: true }).click();
  const zoomed = (await canvas.boundingBox())!;
  const view = page.getByTestId("image-viewport");
  await view.scrollIntoViewIfNeeded();
  const bounds = (await view.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 20, {
    steps: 5
  });
  await page.mouse.up();
  await expect(page.getByTestId("selected-target")).toHaveCount(0);
  expect((await canvas.boundingBox())!.x).toBeCloseTo(zoomed.x + 30, 0);
  expect(await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(original);
  expect(
    (await download(page, "导出标注图片")).equals(Buffer.from(original.split(",")[1], "base64"))
  ).toBe(true);
  expect((await download(page, "导出 JSON")).equals(json)).toBe(true);
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
  await page.getByRole("button", { name: "放大图片", exact: true }).click();
  await page.getByRole("button", { name: "重置视图", exact: true }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
});

test("缩放上下限和拖动边界受控，窗口改变后复位仍显示完整图片", async ({ page }) => {
  await prepare(page);
  const zoomIn = page.getByRole("button", { name: "放大图片", exact: true });
  for (let index = 0; index < 10; index++) await zoomIn.click();
  await expect(page.getByTestId("zoom-level")).toHaveText("800%");
  await expect(zoomIn).toBeDisabled();
  const view = page.getByTestId("image-viewport");
  await view.scrollIntoViewIfNeeded();
  const bounds = (await view.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5000, y + 5000, { steps: 3 });
  await page.mouse.up();
  const content = await page.getByTestId("result-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    return {
      left: rect.x + (rect.width - canvas.width * scale) / 2,
      top: rect.y + (rect.height - canvas.height * scale) / 2
    };
  });
  expect(content.left).toBeCloseTo(bounds.x + 1, 0);
  expect(content.top).toBeCloseTo(bounds.y + 1, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
  await expect(page.getByRole("button", { name: "缩小图片", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("滚轮以指针位置缩放，放大后仍可点击框并由列表定位", async ({ page }) => {
  await prepare(page);
  const result = JSON.parse((await download(page, "导出 JSON")).toString()) as PPDetectionResult;
  const canvas = page.getByTestId("result-canvas");
  const view = page.getByTestId("image-viewport");
  await view.scrollIntoViewIfNeeded();
  const before = (await canvas.boundingBox())!;
  const anchor = { x: before.x + before.width * 0.4, y: before.y + before.height * 0.45 };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -200);
  await expect(page.getByTestId("zoom-level")).not.toHaveText("100%");
  const after = (await canvas.boundingBox())!;
  expect((anchor.x - after.x) / after.width).toBeCloseTo(0.4, 2);
  expect((anchor.y - after.y) / after.height).toBeCloseTo(0.45, 2);
  const box = result.detections[0].box;
  const scale = Math.min(after.width / 1400, after.height / 1249);
  await page.mouse.click(
    after.x + (after.width - 1400 * scale) / 2 + ((box.xMin + box.xMax) / 2) * scale,
    after.y + (after.height - 1249 * scale) / 2 + ((box.yMin + box.yMax) / 2) * scale
  );
  await expect(page.locator(".detection-row")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".detection-row").click();
  await expect(view).toBeInViewport();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("zoom-level")).not.toHaveText("100%");
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
});

test("按住鼠标时滚轮缩放，后续拖动保持新的倍率且不误选目标", async ({ page }) => {
  await prepare(page);
  const view = page.getByTestId("image-viewport");
  await view.scrollIntoViewIfNeeded();
  const bounds = (await view.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.wheel(0, -300);
  const level = page.getByTestId("zoom-level");
  await expect(level).not.toHaveText("100%");
  const zoomed = await level.textContent();
  await page.mouse.move(x + 20, y + 15, { steps: 5 });
  await page.mouse.up();
  await expect(level).toHaveText(zoomed!);
  await expect(page.getByTestId("selected-target")).toHaveCount(0);
});

test("双指缩放及单指拖动后可复位，换图恢复完整视图", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true
  });
  const page = await context.newPage();
  await prepare(page);
  const view = page.getByTestId("image-viewport");
  await view.scrollIntoViewIfNeeded();
  const bounds = (await view.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 30, y, id: 1 },
      { x: x + 30, y, id: 2 }
    ]
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 60, y, id: 1 },
      { x: x + 60, y, id: 2 }
    ]
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByTestId("zoom-level")).toHaveText("200%");
  const canvas = page.getByTestId("result-canvas");
  const initial = (await canvas.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 3 }]
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 40, y: y + 20, id: 3 }]
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect((await canvas.boundingBox())!.x).toBeCloseTo(initial.x + 40, 0);
  await expect(page.getByTestId("selected-target")).toHaveCount(0);
  await page.locator('.sample-card:has(img[src*="people.jpg"])').click();
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await context.close();
});
