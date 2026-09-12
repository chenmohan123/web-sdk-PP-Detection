import { expect, test, type Page } from "playwright/test";
import type { ModelManifest } from "web-sdk-pp-detection";
import { tinyModelManifest } from "../src/fixture";

async function useManifest(page: Page, quantization: string): Promise<void> {
  const fp32 = tinyModelManifest.variants[1];
  const selected: ModelManifest = {
    ...tinyModelManifest,
    variantPriority: ["fp32", "quantized"],
    variants: [
      { ...fp32, backendCompatibility: ["wasm", "webgpu"] },
      {
        ...fp32,
        id: "quantized",
        precision: "int8",
        quantization,
        backendCompatibility: ["webgpu"]
      }
    ]
  };
  await page.getByRole("button", { name: "自定义 manifest", exact: true }).click();
  await page.getByLabel("manifest JSON", { exact: true }).fill(JSON.stringify(selected));
  await page.getByRole("button", { name: "校验", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
}

test("W8A32 选择受清单后端约束，切换不支持的后端后恢复 FP32", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=1");
  await useManifest(page, "weight-only-int8-activation-fp32");
  const precision = page.getByRole("group", { name: "模型精度", exact: true });
  const backend = page.getByRole("group", { name: "运行后端", exact: true });

  await expect(precision.getByRole("button", { name: "自动", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(precision.getByRole("button", { name: "W8A32", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await backend.getByRole("button", { name: "GPU", exact: true }).click();
  await precision.getByRole("button", { name: "W8A32", exact: true }).click();
  await expect(precision.getByRole("button", { name: "W8A32", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await backend.getByRole("button", { name: "CPU", exact: true }).click();
  await expect(precision.getByRole("button", { name: "W8A32", exact: true })).toBeDisabled();
  await expect(precision.getByRole("button", { name: "FP32", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("notice")).toContainText("当前模型不支持该后端下的此精度");
  await expect(precision.getByRole("button", { name: "W8A32", exact: true })).toHaveAttribute(
    "title",
    "当前模型不支持该后端下的此精度。"
  );
});

test("其他 INT8 量化类型不会被显示为 W8A32", async ({ page }) => {
  await page.goto("/?fixture=1");
  await useManifest(page, "static-qdq");
  const precision = page.getByRole("group", { name: "模型精度", exact: true });
  await expect(precision.getByRole("button", { name: "INT8", exact: true })).toBeEnabled();
  await expect(precision.getByRole("button", { name: "W8A32", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Model precision", exact: true }).getByRole("button", {
      name: "INT8",
      exact: true
    })
  ).toBeEnabled();
});
