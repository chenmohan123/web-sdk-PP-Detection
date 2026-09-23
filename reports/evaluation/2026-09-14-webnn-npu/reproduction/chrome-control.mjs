import {chromium} from 'file:///F:/git/00_chenmohan/github/web-sdk-PP-Detection/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
const server=createServer((q,r)=>r.end('<!doctype html><title>WebNN 验证</title>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const log=process.env.TEMP+'/ppdetection-webnn-chrome.log';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-features=WebMachineLearningNeuralNetwork','--enable-logging','--log-file='+log,'--vmodule=*webnn*=2,*tflite*=2']});
const rows=[];
try{
 for(const deviceType of ['npu','gpu']){
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  rows.push(await page.evaluate(async(deviceType)=>{
   const context=await navigator.ml.createContext({deviceType});
   const builder=new MLGraphBuilder(context),descriptor={dataType:'float32',shape:[4]};
   const graph=await builder.build({y:builder.add(builder.input('x',descriptor),builder.constant(descriptor,new Float32Array([2,3,4,5])))});
   const input=await context.createTensor({...descriptor,writable:true}),output=await context.createTensor({...descriptor,readable:true});
   const runs=[];
   try{for(let index=0;index<5;index++){
    const data=new Float32Array([1+index,2+index,3+index,4+index]);
    context.writeTensor(input,data);context.dispatch(graph,{x:input},{y:output});
    const values=Array.from(new Float32Array(await context.readTensor(output))),expected=[3+index,5+index,7+index,9+index];
    runs.push({values,expected,passed:JSON.stringify(values)===JSON.stringify(expected)});
   }}finally{input.destroy();output.destroy();graph.destroy();context.destroy();}
   return {requestedDeviceType:deviceType,runs};
  },deviceType));await page.close();
 }
 const report={testedAt:new Date().toISOString(),browser:'Chrome',version:browser.version(),experimental:true,headless:true,rows};
 await writeFile(process.env.TEMP+'/ppdetection-webnn-control.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
