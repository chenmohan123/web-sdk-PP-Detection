import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(path.join(process.env.PPDETECTION_REPO || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const outputDir = path.resolve(process.argv[2]);
await mkdir(outputDir, { recursive: true });
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>WebNN NPU 验证</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const rows = [];
try {
  for (const channel of ['chrome', 'msedge']) for (const experimental of [false, true]) {
    const logFile = path.join(outputDir, `${channel}-${experimental}.log`);
    const args = ['--enable-logging', `--log-file=${logFile}`, '--vmodule=*webnn*=2'];
    if (experimental) args.push('--enable-features=WebMachineLearningNeuralNetwork');
    const row = { channel, experimental, headless: false, ignoredDefaultArgs: ['--enable-unsafe-swiftshader'] };
    let browser;
    try {
      browser = await chromium.launch({ channel, headless: false, ignoreDefaultArgs: row.ignoredDefaultArgs, args });
      row.version = browser.version();
      const page = await browser.newPage();
      page.setDefaultTimeout(25000);
      await page.goto(origin);
      Object.assign(row, await page.evaluate(async () => {
        const result = { secureContext: isSecureContext, webnnExposed: !!navigator.ml, requestedDeviceType: 'npu', actualPhysicalDevice: null };
        if (!navigator.ml) return result;
        let context, graph, input, output;
        try {
          const operation = async () => {
            context = await navigator.ml.createContext({ deviceType: 'npu' });
            result.contextCreated = true;
            result.limits = context.opSupportLimits();
            const descriptor = { dataType: 'float32', shape: [4] };
            const builder = new MLGraphBuilder(context);
            graph = await builder.build({ y: builder.add(builder.input('x', descriptor), builder.constant(descriptor, new Float32Array([2, 3, 4, 5]))) });
            input = await context.createTensor({ ...descriptor, writable: true });
            output = await context.createTensor({ ...descriptor, readable: true });
            result.runs = [];
            for (let index = 0; index < 5; index++) {
              const data = [1 + index, 2 + index, 3 + index, 4 + index];
              context.writeTensor(input, new Float32Array(data));
              context.dispatch(graph, { x: input }, { y: output });
              const values = Array.from(new Float32Array(await context.readTensor(output)));
              const expected = [3 + index, 5 + index, 7 + index, 9 + index];
              result.runs.push({ input: data, expected, values, passed: JSON.stringify(values) === JSON.stringify(expected) });
            }
          };
          let timer;
          try { await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('NPU 探针超时（20 秒）')), 20000); })]); }
          finally { clearTimeout(timer); }
        } catch (error) { result.error = { name: error.name, message: error.message }; }
        finally { input?.destroy(); output?.destroy(); graph?.destroy(); context?.destroy(); }
        return result;
      }));
      const cdp = await browser.newBrowserCDPSession();
      row.histograms = await cdp.send('Browser.getHistograms', { query: 'WebNN', delta: false });
      await cdp.detach();
    } catch (error) { row.error = { name: error.name, message: error.message }; }
    finally { await browser?.close(); }
    // 只保留 WebNN 原生日志，避免归档浏览器启动路径和无关信息。
    try { row.nativeWebnnLog = (await readFile(logFile, 'utf8')).split(/\r?\n/).filter(line => line.includes('[WebNN]')).map(line => line.slice(line.indexOf('[WebNN]'))); }
    catch { row.nativeWebnnLog = []; }
    rows.push(row);
    const { limits, ...summary } = row;
    console.log(JSON.stringify(summary));
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const report = { testedAt: new Date().toISOString(), purpose: '验证 API 请求和最小图；成功不代表实际物理 NPU', origin, scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), rows };
await writeFile(path.join(outputDir, 'headed-npu.json'), JSON.stringify(report, null, 2) + '\n');
