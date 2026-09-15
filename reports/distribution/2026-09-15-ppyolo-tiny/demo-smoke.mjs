// 对本地预览或正式HTTPS Demo执行Tiny双源/两后端真实检测；正式模式核对部署提交。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
import { chromium } from "playwright";
const [base = "http://127.0.0.1:4175/", out = ".tmp/tiny-release/demo-local"] =
  process.argv.slice(2);
await mkdir(out, { recursive: true });
const manifestPath = "models/ppyolo-tiny-320/0.1.0/manifest.json";
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const variant = manifest.variants[0];
assert.equal(variant.sha256, "1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653");
let deployment;
if (base.startsWith("https://chenmohan123.github.io/")) {
  assert.match(process.env.PPDETECTION_DEPLOYMENT_RUN ?? "", /^\d+$/);
  deployment = JSON.parse(
    execFileSync(
      "gh",
      [
        "run",
        "view",
        process.env.PPDETECTION_DEPLOYMENT_RUN,
        "--repo",
        "chenmohan123/web-sdk-PP-Detection",
        "--json",
        "headSha,headBranch,status,conclusion,workflowName,url"
      ],
      { encoding: "utf8" }
    )
  );
  assert.equal(deployment.headSha, process.env.PPDETECTION_DEPLOYMENT_COMMIT);
  assert.equal(deployment.conclusion, "success");
  assert.equal(deployment.headBranch, "main");
  assert.equal(deployment.workflowName, "GitHub Pages");
  assert.deepEqual(
    execFileSync("git", ["show", `${deployment.headSha}:${manifestPath}`]),
    manifestBytes
  );
  const response = await fetch(new URL(manifestPath, base));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), manifestBytes);
}
const result = {
  date: new Date().toISOString(),
  base,
  deployment,
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
        page.on("pageerror", (e) => result.errors.push(e.message));
        const source = variant.sources.find((x) => x.kind === sourceKind);
        const statuses = [];
        page.on("response", (r) => {
          let q = r.request();
          while (q.redirectedFrom()) q = q.redirectedFrom();
          if (q.url() === source.downloadUrl) statuses.push(r.status());
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
        assert.equal(
          await precision
            .getByRole("button", { name: "FP32", exact: true })
            .getAttribute("aria-pressed"),
          "true"
        );
        assert(await precision.getByRole("button", { name: "FP16", exact: true }).isDisabled());
        assert(await precision.getByRole("button", { name: /INT8|W8A32/ }).isDisabled());
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
            /success|error/.test(document.querySelector('[data-testid="status"]')?.className ?? ""),
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
        assert.equal(detection.model.version, "0.1.0");
        assert.equal(detection.model.variantId, "fp32");
        assert.equal(detection.model.source.kind, sourceKind);
        assert.equal(detection.model.source.sha256, variant.sha256);
        assert.equal(detection.model.source.revision, source.revision);
        assert.equal(detection.runtime.backend, backend);
        assert.equal(detection.runtime.precision, "fp32");
        assert.deepEqual(detection.runtime.fallbacks, []);
        assert(detection.detections.some((x) => x.label === "person"));
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
        await page.screenshot({
          path: resolve(out, `${sourceKind}-${backend}.png`),
          fullPage: true
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      } finally {
        await context.close();
      }
    }
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.errors, []);
  result.status = "passed";
} catch (e) {
  result.status = "failed";
  result.error = String(e);
  throw e;
} finally {
  await browser.close();
  await writeFile(resolve(out, "verification.json"), JSON.stringify(result, null, 2) + "\n");
}
