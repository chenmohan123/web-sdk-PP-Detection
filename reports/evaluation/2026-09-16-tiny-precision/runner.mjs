import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "../../../tools/model-pipeline/browser/evaluation-runner.mjs";
const report=dirname(fileURLToPath(import.meta.url)); const root=resolve(report,"../../.."); const work=resolve(root,".tmp/tiny-precision");
const sha=(x)=>createHash("sha256").update(x).digest("hex"); const read=async p=>JSON.parse(await readFile(p,"utf8"));
const protocol=await read(resolve(report,"protocol.json")); const jobs=await read(resolve(report,"jobs.json"));
const annotations="reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json";
const imageRoot=process.env.PICODET_IMAGE_ROOT||"F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/dataset/images";
const args=new Map(); for(let i=2;i<process.argv.length;i+=2) args.set(process.argv[i],process.argv[i+1]);
const rounds=args.has("--round")?[Number(args.get("--round"))]:protocol.rounds; const selected=jobs.filter(j=>(!args.has("--precision")||j.precision===args.get("--precision"))&&(!args.has("--key")||j.key===args.get("--key")));
if(!selected.length) throw new Error("没有匹配组合");
for(const round of rounds) for(const job of selected) for(const backend of protocol.backends){
  const name=`${job.key}-${job.precision}-${backend}`; const path=resolve(work,`round-${round}`,`${name}.json`); await mkdir(dirname(path),{recursive:true});
  const value=await runEvaluation({model:job.model,manifest:job.manifest,annotations,imageRoot,expectedImages:64,backend,precision:job.precision==='w8a32'?'int8':job.precision,output:path});
  const raw=Buffer.from(JSON.stringify(value,null,2)+"\n"); await writeFile(path,raw); await writeFile(path.replace(/\.json$/,"-binding.json"),JSON.stringify({round,protocolSha256:sha(await readFile(resolve(report,"protocol.json"))),resultSha256:sha(raw)},null,2)+"\n");
  if(value.status!=="passed") process.exitCode=1; console.log(JSON.stringify({round,name,status:value.status}));
}
