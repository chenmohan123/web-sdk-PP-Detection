// 从独立浏览器产物重新计算合并，校验浏览器与本地脚本结果逐框一致。
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {refine,originalCombined} from './merge.mjs';
const out=dirname(dirname(fileURLToPath(import.meta.url)));let count=0;
for(const backend of ['webgpu','wasm'])for(const name of ['picodet','ppyoloe'])for(const variant of backend==='webgpu'?['fp32','fp16','w8a32']:['fp32']){
  const raw=JSON.parse(gunzipSync(await readFile(join(out,'browser',`${name}-${variant}-${backend}.json.gz`))));
  for(const image of raw.images){assert.deepEqual(refine(image,raw.strategy).detections,image.refined);assert.deepEqual(originalCombined(image),image.combined);count++;}
}
assert.equal(count,256);console.log('通过：独立浏览器 256 图次的原组合与冻结合并逐框重算一致');
