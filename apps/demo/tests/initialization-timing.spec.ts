import { expandDetails } from "./details-helpers";
import { expect, test } from "playwright/test";

test("随包清单不触发远端 manifest 请求，运行信息来自实际 ORT", async ({ page }) => {
  const manifestRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("manifest.json") && url.hostname !== "127.0.0.1")
      manifestRequests.push(request.url());
  });
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.getByTestId("sample-gallery").getByRole("button").first().click();
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveClass(/success/);
  expect(manifestRequests).toEqual([]);
  await expandDetails(page, "model-section");
  await expandDetails(page, "performance-details");
  await expect(page.getByTestId("model-section")).toContainText("1.27.0");
  await expect(page.getByTestId("model-section")).toContainText("Chrome/");
  await expect(page.getByTestId("initialization-timings")).toContainText("内存");
});
