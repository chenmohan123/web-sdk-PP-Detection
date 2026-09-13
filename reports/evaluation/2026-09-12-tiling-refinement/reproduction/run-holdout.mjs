// 一次性可行性实验：使用正式 SDK 公共 API，不作为产品实现。
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import {chromium} from 'playwright';
import {validateCategoryMapping,classifyAdapter} from '../../../../tools/model-pipeline/browser/evaluation-runner.mjs';

const here=dirname(fileURLToPath(import.meta.url)),out=dirname(here);
const [name,variant,backend,limitText]=process.argv.slice(2);
if(!['picodet','ppyoloe'].includes(name)||!['fp32','fp16','w8a32'].includes(variant)||!['wasm','webgpu'].includes(backend)) throw new Error('参数：picodet|ppyoloe fp32|fp16|w8a32 wasm|webgpu [图片数量]');
const sha=b=>createHash('sha256').update(b).digest('hex');
const inputsBytes=await readFile(join(out,'inputs.json')),inputs=JSON.parse(inputsBytes);
const selectionBytes=await readFile(join(out,'selection.json')),selection=JSON.parse(selectionBytes);
if(sha(selectionBytes)!==inputs.selectionSha256||sha(await readFile(join(here,'merge.mjs')))!==selection.mergeSha256)throw new Error('冻结策略字节发生变化');
const model=inputs.models.find(x=>x.name===name&&x.variant===variant);
const manifestBytes=await readFile(model.manifest),manifest=JSON.parse(manifestBytes);
const annotationBytes=await readFile(inputs.annotations),annotations=JSON.parse(annotationBytes);
for(const [path,expected] of [[model.path,model.sha256],[inputs.sdkBundle,inputs.sdkSha256],[model.manifest,model.manifestSha256],[inputs.annotations,inputs.annotationsSha256],[join(out,'protocol.md'),inputs.protocolSha256]]) {
  if(sha(await readFile(path))!==expected) throw new Error(`输入字节发生变化：${path}`);
}
const categoryIds=validateCategoryMapping(manifest.labels,annotations.categories);
const limit=limitText===undefined?inputs.images.length:Number(limitText);
if(!Number.isInteger(limit)||limit<1||limit>inputs.images.length) throw new Error('图片数量无效');
const images=inputs.images.slice(0,limit);
for(const image of images) if(sha(await readFile(join(inputs.imageRoot,image.file_name)))!==image.sha256) throw new Error('图片字节变化');
const ortDir=join(inputs.sdkRoot,'packages/sdk/node_modules/onnxruntime-web/dist');
const ortPackage=JSON.parse(await readFile(join(ortDir,'../package.json'),'utf8'));
const routes=new Map([['/sdk.js',inputs.sdkBundle],['/model.onnx',model.path],['/tiling.mjs',join(here,'tiling.mjs')]]);
for(const image of images) routes.set(`/images/${image.file_name}`,join(inputs.imageRoot,image.file_name));
for(const file of await readdir(ortDir)) if(/^ort(?:-|\.).*\.(?:js|mjs|wasm)$/.test(file)) routes.set(`/ort/${file}`,join(ortDir,file));
routes.set('/merge.mjs',join(here,'merge.mjs'));
routes.set('/2026-09-12-tiling/reproduction/tiling.mjs',join(here,'tiling.mjs'));
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><script src="/sdk.js"></script><title>切片检测实验</title><body></body></html>';
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store'); res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  const file=routes.get(path);if(!file){res.writeHead(404).end();return;}
  try {const s=await stat(file);res.writeHead(200,{'Content-Length':s.size,'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.jpg':'image/jpeg'})[extname(file)]??'application/octet-stream'});createReadStream(file).pipe(res);}catch{res.writeHead(500).end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
const result={strategy:selection.chosen,selectionSha256:sha(selectionBytes),status:'running',startedAt:new Date().toISOString(),name,variant,backend,model,categoryIds,imageCount:images.length,inputsSha256:sha(inputsBytes),sdkSha256:inputs.sdkSha256,sdkCommit:inputs.sdkCommit,protocolSha256:inputs.protocolSha256,ortVersion:ortPackage.version,scripts:{},host:{cpu:os.cpus()[0].model,logicalCores:os.cpus().length,platform:os.platform(),release:os.release(),arch:os.arch()},warnings:{},pageErrors:[],images:[]};
for(const file of ['run-holdout.mjs','tiling.mjs','merge.mjs']) result.scripts[file]=sha(await readFile(join(here,file)));
let browser;
try {
  browser=await chromium.launch({channel:'chromium',headless:true});
  result.browserVersion=browser.version();
  const page=await browser.newPage();
  page.on('pageerror',e=>result.pageErrors.push(String(e)));
  page.on('console',msg=>{if(['warning','error'].includes(msg.type())){const key=msg.text();result.warnings[key]=(result.warnings[key]??0)+1;}});
  await page.goto(origin);
  result.adapter=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter)return null;
    globalThis.probeAdapter=adapter; const i=adapter.info??{};
    return {vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:adapter.isFallbackAdapter??i.isFallbackAdapter??null};
  });
  if(backend==='webgpu'&&!classifyAdapter(result.adapter).physical) throw new Error('没有通过物理 GPU 检查');
  result.initialization=await page.evaluate(async({backend,precision,manifest,origin,strategy})=>{
    const ort=await import(backend==='webgpu'?'/ort/ort.webgpu.min.mjs':'/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths=`${origin}/ort/`;ort.env.wasm.numThreads=1;
    if(backend==='webgpu')ort.env.webgpu.adapter=globalThis.probeAdapter;
    const fetchStart=performance.now();const response=await fetch('/model.onnx');if(!response.ok)throw new Error('读取模型失败');
    const data=await response.arrayBuffer(),modelReadMs=performance.now()-fetchStart;
    const initStart=performance.now();
    globalThis.probeDetector=await PPDetection.createPPDetection({allowFallback:false,backend,cache:false,executionMode:'main',model:{data,manifest},ort:{module:ort,wasm:{numThreads:1,paths:`${origin}/ort/`}},precision});
    globalThis.probeTiling=await import('/tiling.mjs');
    globalThis.probeRefine=await import('/merge.mjs');globalThis.probeStrategy=strategy;
    const d=globalThis.probeDetector;
    return {modelReadMs,initializeWallMs:performance.now()-initStart,model:d.model,runtime:d.runtime,loadTimings:d.loadTimings,sdkVersion:PPDetection.CURRENT_SDK_VERSION,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated};
  },{backend,precision:model.precision,manifest,origin,strategy:selection.chosen});
  if(result.initialization.sdkVersion!==inputs.sdkVersion)throw new Error('SDK 版本不一致');
  async function runImage(image,index){
    return page.evaluate(async({image,index})=>{
      const {tileGrid,cropRaster,projectDetection,mergeDetections}=globalThis.probeTiling,d=globalThis.probeDetector;
      const response=await fetch(`/images/${image.file_name}`);if(!response.ok)throw new Error('图片读取失败');const blob=await response.blob();
      const decodeStart=performance.now(),bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(bitmap,0,0);const raster={width:bitmap.width,height:bitmap.height,rgba:context.getImageData(0,0,bitmap.width,bitmap.height).data};bitmap.close();
      const decodeMs=performance.now()-decodeStart;
      if(raster.width!==image.width||raster.height!==image.height)throw new Error('解码尺寸与标注不一致');
      const grid=tileGrid(raster.width,raster.height),tiles=[],projected=[];let whole,wholeMs;
      async function detectWhole(){const t=performance.now();whole=await d.detect(raster,{threshold:.001});wholeMs=performance.now()-t;}
      async function detectTiles(){for(const tile of grid){
        const t=performance.now(),crop=cropRaster(raster,tile),cropMs=performance.now()-t;
        const start=performance.now(),r=await d.detect(crop,{threshold:.001}),detectMs=performance.now()-start;
        const mapStart=performance.now(),mapped=r.detections.map(x=>projectDetection(x,tile)).filter(Boolean),projectMs=performance.now()-mapStart;
        projected.push(...mapped);tiles.push({tile,cropMs,detectMs,projectMs,timings:r.timings,detections:r.detections,projected:mapped});
      }}
      if(index%2===0){await detectWhole();await detectTiles();}else{await detectTiles();await detectWhole();}
      const tileStart=performance.now(),tiled=mergeDetections(projected),tileMergeMs=performance.now()-tileStart;
      const combinedStart=performance.now(),combined=mergeDetections([...whole.detections,...projected]),combinedMergeMs=performance.now()-combinedStart;
      const cropMs=tiles.reduce((n,t)=>n+t.cropMs,0),tileDetectMs=tiles.reduce((n,t)=>n+t.detectMs,0),projectMs=tiles.reduce((n,t)=>n+t.projectMs,0);
      const refineStart=performance.now(),refinement=globalThis.probeRefine.refine({whole:whole.detections,tiles,width:raster.width,height:raster.height},globalThis.probeStrategy),refinementMs=performance.now()-refineStart;
      return {refined:refinement.detections,refinementTrace:refinement.trace,refinementMs,imageId:image.id,fileName:image.file_name,width:raster.width,height:raster.height,order:index%2===0?'whole-first':'tiles-first',decodeMs,wholeMs,cropMs,tileDetectMs,projectMs,tileMergeMs,combinedMergeMs,modeMs:{refined:decodeMs+wholeMs+cropMs+tileDetectMs+projectMs+refinementMs,whole:decodeMs+wholeMs,tiles:decodeMs+cropMs+tileDetectMs+projectMs+tileMergeMs,combined:decodeMs+wholeMs+cropMs+tileDetectMs+projectMs+combinedMergeMs},wholeTimings:whole.timings,tiles,whole:whole.detections,tiled,combined};
    },{image,index});
  }
  const warmup=await runImage(images[0],0);result.warmup={imageId:warmup.imageId,modeMs:warmup.modeMs,inferenceCount:1+warmup.tiles.length};
  console.log(`${name}/${variant}/${backend} 预热完成`);
  for(const [index,image] of images.entries()){
    result.images.push(await runImage(image,index));
    if((index+1)%8===0||index+1===images.length)console.log(`${name}/${variant}/${backend} ${index+1}/${images.length}`);
  }
  if(result.pageErrors.length)throw new Error('浏览器报告未捕获错误');
  result.status='passed';
}catch(error){result.status='failed';result.error={message:String(error),stack:error?.stack};process.exitCode=1;}
finally{
  if(browser){for(const context of browser.contexts())for(const page of context.pages())await page.evaluate(async()=>{await globalThis.probeDetector?.dispose();}).catch(()=>{});await browser.close();}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  result.completedAt=new Date().toISOString();
  const suffix=limit===inputs.images.length?'':`-sanity${limit}`,file=join(inputs.outputs,`${name}-${variant}-${backend}${suffix}.json.gz`);
  await writeFile(file,gzipSync(JSON.stringify(result),{level:9}));
  console.log(JSON.stringify({status:result.status,file,images:result.images.length,error:result.error??null}));
}
