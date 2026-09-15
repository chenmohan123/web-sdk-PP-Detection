import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const reportDirectory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(reportDirectory, "../../..");
const output = resolve(root, ".tmp/picodet-series-precision-production");
await mkdir(output, { recursive: true });
const run = process.env.PPDETECTION_DEPLOYMENT_RUN;
assert.match(run ?? "", /^[0-9]+$/);
// 复用宿主 gh 登录，核对 SDK 的成功 Pages 记录与受保护 main 提交。
const deployment = JSON.parse(
  execFileSync(
    "gh",
    [
      "run",
      "view",
      run,
      "--repo",
      "chenmohan123/web-sdk-PP-Detection",
      "--json",
      "headSha,headBranch,conclusion,status,workflowName,url"
    ],
    { encoding: "utf8" }
  )
);
assert.equal(deployment.workflowName, "GitHub Pages");
assert.equal(deployment.headBranch, "main");
assert.equal(deployment.status, "completed");
assert.equal(deployment.conclusion, "success");
assert.equal(deployment.headSha, process.env.PPDETECTION_DEPLOYMENT_COMMIT);
const jobs = JSON.parse(await readFile(resolve(reportDirectory, "published-jobs.json"), "utf8"));
const picoKeys = [
  "xs-320",
  "xs-416",
  "s-320",
  "s-416",
  "m-320",
  "m-416",
  "l-320",
  "l-416",
  "l-640"
].map((key) => `picodet-${key}`);
const allKeys = [...picoKeys, ...["s", "m", "l", "x"].map((size) => `ppyoloe-plus-${size}-640`)];
const url = "https://chenmohan123.github.io/web-sdk-PP-Detection/";
const report = {
  testedAt: new Date().toISOString(),
  url,
  deployment,
  os: { platform: os.platform(), release: os.release(), arch: os.arch() },
  manifests: [],
  rows: [],
  pageErrors: [],
  status: "running"
};
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tmp/dependencies-compatible-browsers");
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "chromium", headless: true });
report.browser = browser.version();
try {
  for (const job of jobs) {
    const key = job.key;
    assert(job, `缺少 ${key} 评测记录`);
    const expected = execFileSync("git", ["show", `${deployment.headSha}:${job.manifest}`], {
      cwd: root
    });
    const response = await fetch(new URL(job.manifest, url), {
      signal: AbortSignal.timeout(60000)
    });
    assert.equal(response.status, 200);
    const deployed = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(deployed, expected, `${key} 正式清单与部署提交字节不符`);
    const manifest = JSON.parse(deployed);
    const variant = manifest.variants.find((item) => item.id === job.precision);
    const source = variant.sources.find((item) => item.kind === "modelscope");
    report.manifests.push({
      key,
      path: job.manifest,
      sha256: createHash("sha256").update(deployed).digest("hex")
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      const sourceResponses = [];
      page.on("response", (response) => {
        let request = response.request();
        while (request.redirectedFrom()) request = request.redirectedFrom();
        if (request.url() === source.downloadUrl) sourceResponses.push(response.status());
      });
      assert.equal((await page.goto(url, { timeout: 60000 })).status(), 200);
      const models = page.getByLabel("检测模型", { exact: true });
      assert.deepEqual(
        await models.locator("option").evaluateAll((items) => items.map((item) => item.value)),
        allKeys
      );
      assert.equal(await models.inputValue(), "picodet-l-320");
      await models.selectOption(key);
      const sources = page.getByLabel("模型来源", { exact: true });
      assert.equal(await sources.inputValue(), "modelscope");
      assert.deepEqual(await sources.locator("option").allTextContents(), [
        "ModelScope",
        "Hugging Face"
      ]);
      const precision = page.getByRole("group", { name: "模型精度", exact: true });
      assert.equal(
        await precision
          .getByRole("button", { name: "FP32", exact: true })
          .getAttribute("aria-pressed"),
        "true"
      );
      const chosenPrecision = job.precision === "w8a32" ? "W8A32" : "FP16";
      assert(
        await precision.getByRole("button", { name: chosenPrecision, exact: true }).isEnabled()
      );
      await precision.getByRole("button", { name: chosenPrecision, exact: true }).click();
      if (key.startsWith("picodet-xs-")) {
        assert(await precision.getByRole("button", { name: "INT8", exact: true }).isDisabled());
      }
      await page
        .locator(".sample-card")
        .filter({ has: page.locator('img[src*="people.jpg"]') })
        .click();
      for (const backend of ["CPU", "GPU"]) {
        await page.getByRole("button", { name: backend, exact: true }).click();
        await page.getByRole("button", { name: "开始检测", exact: true }).click();
        await page.waitForFunction(
          () =>
            /success|error/.test(document.querySelector('[data-testid="status"]')?.className ?? ""),
          undefined,
          { timeout: 240000 }
        );
        assert(
          (await page.getByTestId("status").textContent()).includes("检测完成"),
          `${key}/${backend}: ${await page.getByRole("alert").allTextContents()}`
        );
        const pending = page.waitForEvent("download");
        await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
        const result = JSON.parse(await readFile(await (await pending).path(), "utf8"));
        assert.equal(result.model.id, manifest.model.id);
        assert.equal(result.model.version, manifest.model.version);
        assert.equal(result.model.variantId, job.precision);
        assert.equal(result.model.precision, variant.precision);
        assert.equal(result.model.bytes, variant.bytes);
        assert.equal(result.model.source.kind, "modelscope");
        assert.equal(result.model.source.revision, source.revision);
        assert.equal(result.model.source.sha256, variant.sha256);
        assert.equal(result.runtime.backend, backend === "CPU" ? "wasm" : "webgpu");
        assert.equal(result.runtime.fallbacks.length, 0);
        assert(result.detections.some((item) => item.label === "person"));
        assert(sourceResponses.includes(200), "没有观察到正式 ModelScope 下载成功");
        report.rows.push({
          key,
          precision: job.precision,
          backend,
          sourceResponses: [...sourceResponses],
          model: result.model,
          runtime: result.runtime,
          detectionCount: result.detections.length
        });
        await writeFile(
          resolve(output, `${key}-${job.precision}-${backend}.json`),
          JSON.stringify(result, null, 2) + "\n"
        );
        await page.screenshot({
          path: resolve(output, `${key}-${job.precision}-${backend}.png`),
          fullPage: true
        });
        await writeFile(
          resolve(output, "verification.json"),
          JSON.stringify(report, null, 2) + "\n"
        );
        console.log(
          JSON.stringify({ key, backend, detections: result.detections.length, status: "通过" })
        );
      }
    } finally {
      await context.close();
    }
  }
  assert.equal(report.manifests.length, jobs.length);
  assert.equal(report.rows.length, jobs.length * 2);
  assert.deepEqual(report.pageErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(resolve(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
}
