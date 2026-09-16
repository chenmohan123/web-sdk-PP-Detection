// 对本地 Demo 执行 Tiny FP16 双源/两后端真实检测，并验证桌面与窄屏布局。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

process.env.PLAYWRIGHT_BROWSERS_PATH ??=
  "F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers";
const { chromium } = await import("playwright");
const [base = "http://127.0.0.1:4175/", out = ".tmp/tiny-precision/demo-local"] =
  process.argv.slice(2);
await mkdir(out, { recursive: true });
const manifestPath = "models/ppyolo-tiny-320/0.1.1/manifest.json";
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const variant = manifest.variants.find(({ id }) => id === "fp16");
assert.equal(variant.sha256, "331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc");
assert.deepEqual(
  manifest.variants.map(({ id }) => id),
  ["fp32", "fp16"]
);
const result = {
  date: new Date().toISOString(),
  base,
  os: os.release(),
  cpu: os.cpus()[0].model,
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  rows: [],
  errors: [],
  status: "running"
};
const browser = await chromium.launch({ channel: "chromium", headless: true });
result.browser = browser.version();
try {
  for (const sourceKind of ["modelscope", "huggingface"])
    for (const backend of ["wasm", "webgpu"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        locale: "zh-CN"
      });
      try {
        const page = await context.newPage();
        page.on("pageerror", (error) => result.errors.push(error.message));
        const source = variant.sources.find(({ kind }) => kind === sourceKind);
        const statuses = [];
        page.on("response", (response) => {
          let request = response.request();
          while (request.redirectedFrom()) request = request.redirectedFrom();
          if (request.url() === source.downloadUrl) statuses.push(response.status());
        });
        assert.equal((await page.goto(base)).status(), 200);
        const models = page.getByLabel("检测模型", { exact: true });
        await models.waitFor();
        assert.equal(await models.inputValue(), "picodet-l-320");
        assert.equal(await models.locator("option").count(), 14);
        await models.selectOption("ppyolo-tiny-320");
        const sources = page.getByLabel("模型来源", { exact: true });
        assert.equal(await sources.inputValue(), "modelscope");
        assert.deepEqual(await sources.locator("option").allTextContents(), [
          "ModelScope",
          "Hugging Face"
        ]);
        await sources.selectOption(sourceKind);
        const precision = page.getByRole("group", { name: "模型精度", exact: true });
        assert(await precision.getByRole("button", { name: "FP16", exact: true }).isEnabled());
        assert.equal(
          await precision.getByRole("button", { name: "W8A32", exact: true }).count(),
          0
        );
        await precision.getByRole("button", { name: "FP16", exact: true }).click();
        await page
          .locator(".sample-card")
          .filter({ has: page.locator('img[src*="people.jpg"]') })
          .click();
        await page
          .getByRole("button", { name: backend === "wasm" ? "CPU" : "GPU", exact: true })
          .click();
        await page.getByRole("button", { name: "开始检测", exact: true }).click();
        await page.waitForFunction(
          () =>
            /success|error/u.test(
              document.querySelector('[data-testid="status"]')?.className ?? ""
            ),
          undefined,
          { timeout: 180000 }
        );
        assert(
          (await page.getByTestId("status").textContent()).includes("检测完成"),
          await page.getByRole("alert").allTextContents()
        );
        const downloading = page.waitForEvent("download");
        await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
        const detection = JSON.parse(await readFile(await (await downloading).path(), "utf8"));
        assert.equal(detection.model.id, "ppyolo-tiny-320");
        assert.equal(detection.model.version, "0.1.1");
        assert.equal(detection.model.variantId, "fp16");
        assert.equal(detection.model.source.kind, sourceKind);
        assert.equal(detection.model.source.sha256, variant.sha256);
        assert.equal(detection.model.source.revision, source.revision);
        assert.equal(detection.runtime.backend, backend);
        assert.equal(detection.runtime.precision, "fp16");
        assert.deepEqual(detection.runtime.fallbacks, []);
        assert(detection.detections.some(({ label }) => label === "person"));
        assert(statuses.includes(200));
        const row = {
          source: sourceKind,
          backend,
          model: detection.model,
          runtime: detection.runtime,
          detections: detection.detections.length,
          statuses,
          status: "passed"
        };
        result.rows.push(row);
        console.log(JSON.stringify(row));
        await writeFile(
          resolve(out, `${sourceKind}-${backend}.json`),
          JSON.stringify(detection, null, 2) + "\n"
        );
        if (sourceKind === "modelscope" && backend === "webgpu")
          await page.screenshot({ path: resolve(out, "desktop.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (sourceKind === "modelscope" && backend === "webgpu")
          await page.screenshot({ path: resolve(out, "narrow-390.png"), fullPage: true });
      } finally {
        await context.close();
      }
    }
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.errors, []);
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(resolve(out, "verification.json"), JSON.stringify(result, null, 2) + "\n");
}
