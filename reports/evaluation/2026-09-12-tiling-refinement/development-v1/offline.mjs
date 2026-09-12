// 一次性 COCO 诊断：不重新推理，复用第一轮每个切片的原始坐标。
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {strategies,refine,internalEdge,containment,originalCombined} from './merge.mjs';
const out=dirname(dirname(fileURLToPath(import.meta.url))),before=join(out,'../2026-09-12-tiling');
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(internalEdge({x:0,y:0,width:2,height:2},{x:0,y:0,width:60,height:60},100,100),false);
assert.equal(internalEdge({x:40,y:30,width:2,height:2},{x:40,y:0,width:60,height:60},100,100),true);
assert.equal(containment({x:0,y:0,width:20,height:20},{x:5,y:5,width:2,height:2}),1);
const whole={classId:1,score:.6,box:{x:0,y:0,width:20,height:20}};
const synthetic={width:100,height:100,whole:[whole],tiles:[{tile:{x:0,y:0,width:60,height:60},projected:[{...whole,score:.9}]}]};
assert.deepEqual(refine(synthetic,'whole-first').detections,[whole]);
synthetic.tiles[0].projected[0].classId=2;assert.equal(refine(synthetic,'whole-first').detections.length,2);
console.log('通过：原图边缘保留、内侧截断、包含关系、整图优先与异类保留');
if(process.argv.includes('--check'))process.exit(0);
await mkdir(join(out,'predictions'),{recursive:true});
const previous=JSON.parse(await readFile(join(before,'summary.json'),'utf8'));
const runs=[];
for(const name of ['picodet','ppyoloe']){
  const filename=`${name}-fp32-webgpu.json.gz`,bytes=await readFile(join(before,'browser',filename));
  const expected=previous.runs.find(r=>r.name===name&&r.variant==='fp32'&&r.backend==='webgpu');assert.equal(hash(bytes),expected.sha256);
  const run=JSON.parse(gunzipSync(bytes)),result={name,categoryIds:run.categoryIds,sourceSha256:hash(bytes),images:[],reasonCounts:{}};
  for(const image of run.images){
    assert.deepEqual(originalCombined(image),image.combined,'旧组合必须逐框一致');
    const modes={whole:image.whole,combined:image.combined};const traces={};
    for(const strategy of strategies){const r=refine(image,strategy);modes[strategy]=r.detections;traces[strategy]=r.trace;const counts=result.reasonCounts[strategy]??={};for(const t of r.trace)if(t.score>=.5)counts[t.reason]=(counts[t.reason]??0)+1;}
    result.images.push({imageId:image.imageId,modes,traces});
  }
  const target=join(out,'predictions',`${name}-diagnostic.json.gz`);const content=gzipSync(JSON.stringify(result),{level:9});await writeFile(target,content);
  runs.push({name,file:`predictions/${name}-diagnostic.json.gz`,sha256:hash(content),sourceSha256:hash(bytes),reasonCounts:result.reasonCounts});
  console.log(`${name} 64 图离线合并完成`);
}
await writeFile(join(out,'diagnostic-inputs.json'),JSON.stringify({protocolSha256:hash(await readFile(join(out,'protocol.md'))),mergeSha256:hash(await readFile(join(out,'reproduction/merge.mjs'))),runs},null,2));
