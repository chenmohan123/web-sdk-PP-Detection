import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from 'file:///F:/git/00_chenmohan/github/web-sdk-PP-Detection/node_modules/playwright/index.mjs';

const browsers = [
  {name:'Chrome', executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},
  {name:'Edge', executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'},
  {name:'Chromium', executablePath:'F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers/chromium-1243/chrome-win64/chrome.exe'}
];
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>WebNN NPU 本机验证</title>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const rows=[];
try {
  for (const item of browsers) for (const experimental of [false,true]) {
    const flags=experimental?['--enable-features=WebMachineLearningNeuralNetwork']:[];
    let browser;
    const row={browser:item.name,experimental,flags};
    try {
      browser=await chromium.launch({executablePath:item.executablePath,headless:true,args:flags});
      row.version=browser.version();
      const page=await browser.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      Object.assign(row,await page.evaluate(async()=>{
        const result={secureContext:isSecureContext,userAgent:navigator.userAgent,webnnExposed:!!navigator.ml,contexts:[]};
        if(!navigator.ml) return result;
        for(const requestedDeviceType of ['npu','cpu','gpu']) {
          let context,graph,input,output,timer;
          const entry={requestedDeviceType,contextCreated:false};
          const started=performance.now();
          try {
            const creation=navigator.ml.createContext({deviceType:requestedDeviceType});
            context=await Promise.race([creation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('上下文创建超时（20 秒）')),20000);})]);
            clearTimeout(timer);entry.contextCreated=true;
            entry.limits=typeof context.opSupportLimits==='function'?context.opSupportLimits():null;
            const builder=new MLGraphBuilder(context);
            const descriptor={dataType:'float32',shape:[4]};
            const x=builder.input('x',descriptor);
            const y=builder.add(x,builder.constant(descriptor,new Float32Array([2,3,4,5])));
            graph=await builder.build({y});
            input=await context.createTensor({...descriptor,writable:true});
            output=await context.createTensor({...descriptor,readable:true});
            context.writeTensor(input,new Float32Array([1,2,3,4]));
            context.dispatch(graph,{x:input},{y:output});
            const values=Array.from(new Float32Array(await context.readTensor(output)));
            entry.minimalGraph={operation:'add',dataType:'float32',values,passed:JSON.stringify(values)==='[3,5,7,9]'};
          } catch(error) {
            entry.error={name:error.name,message:error.message};
          } finally {
            clearTimeout(timer);input?.destroy();output?.destroy();graph?.destroy();context?.destroy();
            entry.elapsedMs=performance.now()-started;
          }
          result.contexts.push(entry);
        }
        return result;
      }));
      row.pageErrors=errors;
    }catch(error){row.error={name:error.name,message:error.message};}
    finally{await browser?.close();}
    rows.push(row);
    console.log(JSON.stringify({...row,contexts:row.contexts?.map(({limits,...rest})=>rest)}));
  }
} finally {await new Promise(resolve=>server.close(resolve));}
const result={testedAt:new Date().toISOString(),os:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,secureOrigin:origin,headless:true,scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),rows};
await writeFile(process.env.TEMP+'/ppdetection-webnn-probe.json',JSON.stringify(result,null,2)+'\n');
