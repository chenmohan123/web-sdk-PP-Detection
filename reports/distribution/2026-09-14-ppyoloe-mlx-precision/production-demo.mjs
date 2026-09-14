import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reportDirectory = fileURLToPath(new URL('.', import.meta.url));
const sdk = resolve(reportDirectory, '../../..');
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(sdk, '.tmp/dependencies-compatible-browsers');
const { chromium } = await import(pathToFileURL(resolve(sdk, 'node_modules/playwright/index.mjs')));
const output = resolve(sdk, '.tmp/ppyoloe-mlx-precision-live-20260914');
await mkdir(output, { recursive: true });
const report = {
  testedAt: new Date().toISOString(),
  url: 'https://chenmohan123.github.io/web-sdk-PP-Detection/',
  deploymentCommit: process.env.PPDETECTION_DEPLOYMENT_COMMIT,
  rows: [],
  pageErrors: [],
};
assert.match(report.deploymentCommit ?? '', /^[a-f0-9]{40}$/);
const browser = await chromium.launch({ channel: 'chromium', headless: true });
report.browser = browser.version();
try {
  for (const size of ['m', 'l', 'x']) {
    for (const precisionId of ['fp16', 'w8a32']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    const version = '0.1.1';
    const manifest = JSON.parse(await readFile(resolve(sdk, `models/ppyoloe-plus-${size}-640/${version}/manifest.json`), 'utf8'));
    const variant = manifest.variants.find(item => item.id === precisionId);
    const source = variant.sources.find(item => item.kind === 'modelscope');
    const sourceResponses = [];
    page.on('response', response => {
      let request = response.request();
      while (request.redirectedFrom()) request = request.redirectedFrom();
      if (request.url() === source.downloadUrl) sourceResponses.push(response.status());
    });
    assert.equal((await page.goto(report.url, { timeout: 60000 })).status(), 200);
    const modelSelect = page.getByLabel('检测模型', { exact: true });
    assert.deepEqual(await modelSelect.locator('option').evaluateAll(items => items.map(item => item.value)), [
      'picodet-l-320', 'ppyoloe-plus-s-640', 'ppyoloe-plus-m-640', 'ppyoloe-plus-l-640', 'ppyoloe-plus-x-640',
    ]);
    await modelSelect.selectOption(`ppyoloe-plus-${size}-640`);
    const sourceSelect = page.getByLabel('模型来源', { exact: true });
    assert.equal(await sourceSelect.inputValue(), 'modelscope');
    assert.deepEqual(await sourceSelect.locator('option').allTextContents(), ['ModelScope', 'Hugging Face']);
    const precision = page.getByRole('group', { name: '模型精度', exact: true });
    assert.equal(await precision.getByRole('button', { name: 'FP32', exact: true }).getAttribute('aria-pressed'), 'true');
    for (const name of ['FP32', 'FP16', 'W8A32'])
      assert(await precision.getByRole('button', { name, exact: true }).isEnabled());
    await precision.getByRole('button', { name: precisionId === 'fp16' ? 'FP16' : 'W8A32', exact: true }).click();
    await page.locator('.sample-card').filter({ has: page.locator('img[src*="people.jpg"]') }).click();
    for (const backend of ['CPU', 'GPU']) {
      await page.getByRole('button', { name: backend, exact: true }).click();
      await page.getByRole('button', { name: '开始检测', exact: true }).click();
      await page.waitForFunction(() => /success|error/.test(document.querySelector('[data-testid="status"]')?.className ?? ''), undefined, { timeout: 240000 });
      const status = await page.getByTestId('status').textContent();
      assert(status.includes('检测完成'), `${size}/${backend}: ${status}; ${await page.getByRole('alert').allTextContents()}`);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
      const result = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
      assert.equal(result.model.id, manifest.model.id);
      assert.equal(result.model.precision, variant.precision);
      assert.equal(result.model.version, '0.1.1');
      assert.equal(result.model.variantId, precisionId);
      assert.equal(result.model.source.revision, source.revision);
      assert.equal(result.model.bytes, variant.bytes);
      assert.equal(result.model.source.kind, 'modelscope');
      assert.equal(result.model.source.sha256, variant.sha256);
      assert.equal(result.runtime.backend, backend === 'CPU' ? 'wasm' : 'webgpu');
      assert.equal(result.runtime.fallbacks.length, 0);
      assert(result.detections.some(item => item.label === 'person'));
      if (backend === 'CPU') assert(sourceResponses.includes(200), '未观察到正式 ModelScope 下载成功');
      const row = { size, precisionId, backend, sourceResponses: [...sourceResponses], model: result.model, runtime: result.runtime, detectionCount: result.detections.length };
      report.rows.push(row);
      await writeFile(resolve(output, `${size}-${precisionId}-${backend}.json`), JSON.stringify(result, null, 2) + '\n');
      await page.screenshot({ path: resolve(output, `${size}-${precisionId}-${backend}.png`), fullPage: true });
      await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ size, precisionId, backend, detectionCount: row.detectionCount, status: '通过' }));
    }
    await context.close();
    }
  }
  assert.equal(report.rows.length, 12);
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
