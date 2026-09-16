"""复算 Tiny 三精度三轮质量，生成压缩证据、summary 和收据。"""
from __future__ import annotations
import argparse, copy, gzip, hashlib, json, math, statistics, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
REPORT=Path(__file__).resolve().parent; ROOT=REPORT.parents[2]; WORK=ROOT/".tmp/tiny-precision"; sys.path.insert(0,str(ROOT/"tools/model-pipeline"))
from evaluation import compare_detections, evaluate_coco
PRECISIONS=["fp32","fp16","w8a32"]; BACKENDS=["wasm","webgpu"]; ANNOTATIONS=ROOT/"reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json"; ANNOTATIONS_SHA="d398fc9b09d97135e9b92d28d170681ed50bcd3a5518f16f559e6e379adc1b79"
def read(p): return json.loads(Path(p).read_text(encoding="utf-8"))
def sha(x): return hashlib.sha256(x).hexdigest()
def precision(p): return "int8" if p=="w8a32" else p
def quality_pass(delta,ret): return math.isfinite(delta) and delta>=-.5 and ret>=.95
def require(v,m):
    if not v: raise ValueError(m)
def validate_protocol_jobs(protocol,jobs):
    require(protocol["rounds"]==[1,2,3] and protocol["backends"]==BACKENDS and protocol["precisions"]==PRECISIONS and protocol["models"]==["ppyolo-tiny-320"],"协议轴错误")
    require(protocol["dataset"]=={"images":64,"annotations":716,"annotationsSha256":ANNOTATIONS_SHA},"数据集协议错误")
    require(protocol["qualityGate"]=={"maximumApDropPoints":.5,"minimumReferenceRetention":.95,"scoreThreshold":.5,"iouThreshold":.5,"strictIouDiagnostic":.99},"门槛错误")
    require(len(jobs)==3 and {(j["key"],j["precision"]) for j in jobs}=={("ppyolo-tiny-320",p) for p in PRECISIONS},"jobs 缺失或重复")
    for j in jobs: require(j["inputSize"]==320 and isinstance(j["bytes"],int) and len(j["sha256"])==64,"模型身份错误")
def validate_job_source(job):
    p=ROOT/job["model"]; require(p.exists(),"模型文件缺失"); data=p.read_bytes(); require(len(data)==job["bytes"] and sha(data)==job["sha256"],"模型摘要不符"); source=ROOT/job["sourceModel"]; source_data=source.read_bytes(); require(len(source_data)==job["sourceBytes"] and sha(source_data)==job["sourceSha256"]=="1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653","源摘要不符")
def parity(ref,cand,ids,threshold):
    left,right=defaultdict(list),defaultdict(list)
    for x in ref:
        if x["score"]>=.5:left[x["image_id"]].append(x)
    for x in cand:
        if x["score"]>=.5:right[x["image_id"]].append(x)
    rows=[compare_detections(left[i],right[i],iou_threshold=threshold,score_threshold=.5) for i in ids]; total=sum(x["referenceCount"] for x in rows); matched=sum(x["matchedCount"] for x in rows)
    return {"referenceCount":total,"matchedCount":matched,"fraction":matched/total if total else 1.0}
def environment(v): return {"cpu":v["environment"]["cpu"],"os":v["environment"]["os"],"browser":v["environment"]["browser"],"runtimeVersions":v["runtimeVersions"]}
def synthetic_record(job,lock,backend):
    ident=lock["models"][f"{job['key']}-{job['precision']}"]
    return {"schemaVersion":1,"status":"passed","capturedAt":"2026-09-16T00:00:00Z","environment":lock["environment"],"runtimeVersions":lock["environment"]["runtimeVersions"],"runtime":{"requestedBackend":backend,"backend":backend,"mode":"main","precision":precision(job["precision"]),"fallbacks":[]},"model":{"id":ident["modelId"],"version":ident["modelVersion"],"variantId":job["precision"],"precision":precision(job["precision"]),"bytes":job["bytes"]},"evaluation":{},"artifacts":{"model":{"sha256":job["sha256"],"bytes":job["bytes"]},"manifest":{"sha256":ident["manifestSha256"]},"sdk":{"sha256":lock["sdkSha256"]},"annotations":{"sha256":ANNOTATIONS_SHA},"imageCount":64,"imageSetSha256":lock["imageSetSha256"]},"images":[{**x,"wallClockMs":1.0} for x in lock["images"]],"predictions":[]}
def validate_record(v,binding,raw,job,backend,round_no,lock):
    require(binding=={"round":round_no,"protocolSha256":lock["protocolSha256"],"resultSha256":sha(raw)},"证据绑定错误"); require(v.get("status")=="passed","评测未通过"); require(environment(v)==lock["environment"],"环境变化"); r=v["runtime"]; require(r["requestedBackend"]==backend and r["backend"]==backend and r["mode"]=="main" and r["fallbacks"]==[] and r["precision"]==precision(job["precision"]),"运行时身份错误"); m=v["model"]; ident=lock["models"][f"{job['key']}-{job['precision']}"]; require(m["id"]==ident["modelId"] and m["version"]==ident["modelVersion"] and m["variantId"]==job["precision"] and m["precision"]==precision(job["precision"]) and m["bytes"]==job["bytes"],"模型身份错误"); a=v["artifacts"]
    for name,expected in (("model",job["sha256"]),("manifest",ident["manifestSha256"]),("sdk",lock["sdkSha256"]),("annotations",ANNOTATIONS_SHA)): require(a[name]["sha256"]==expected,f"{name} 摘要错误")
    require(a["model"]["bytes"]==job["bytes"] and a["imageCount"]==64 and a["imageSetSha256"]==lock["imageSetSha256"],"图集身份错误"); require(len(v["images"])==64,"图片数量错误")
    for actual,expected in zip(v["images"],lock["images"]): require({k:actual[k] for k in ("fileName","imageId","sha256")}==expected and math.isfinite(actual["wallClockMs"]),"图片清单或耗时错误")
    if backend=="webgpu": require(v["environment"]["gpu"]["physical"] is True and v["environment"]["gpu"]["adapter"]==lock["gpuAdapter"],"非固定物理 GPU")
    return datetime.fromisoformat(v["capturedAt"].replace("Z","+00:00"))
def make_lock(image_root):
    protocol,jobs=read(REPORT/"protocol.json"),read(REPORT/"jobs.json"); validate_protocol_jobs(protocol,jobs); ann=read(ANNOTATIONS); require(sha(ANNOTATIONS.read_bytes())==ANNOTATIONS_SHA and len(ann["images"])==64 and len(ann["annotations"])==716,"标注错误"); imgs=[{"fileName":x["file_name"],"imageId":x["id"],"sha256":sha((image_root/x["file_name"]).read_bytes())} for x in ann["images"]]; models={}
    for j in jobs: validate_job_source(j); mf=ROOT/j["manifest"]; models[f"{j['key']}-{j['precision']}"]={"manifestSha256":sha(mf.read_bytes()),"modelId":read(mf)["model"]["id"],"modelVersion":read(mf)["model"]["version"]}
    ref=read(WORK/"round-1/ppyolo-tiny-320-fp32-webgpu.json"); return {"protocolSha256":sha((REPORT/"protocol.json").read_bytes()),"jobsSha256":sha((REPORT/"jobs.json").read_bytes()),"sdkSha256":sha((ROOT/"packages/sdk/dist/browser-global.js").read_bytes()),"images":imgs,"imageSetSha256":sha("\n".join(f"{x['fileName']}:{x['sha256']}" for x in imgs).encode()),"models":models,"environment":environment(ref),"gpuAdapter":ref["environment"]["gpu"]["adapter"]}
def summarize(archive=False):
    image_root=Path("F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/dataset/images"); protocol,jobs=read(REPORT/"protocol.json"),read(REPORT/"jobs.json"); validate_protocol_jobs(protocol,jobs)
    if archive:
      lock=make_lock(image_root); (REPORT/"inputs.lock.json").write_text(json.dumps(lock,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    else:
      lock=read(REPORT/"inputs.lock.json"); require(lock["protocolSha256"]==sha((REPORT/"protocol.json").read_bytes()) and lock["jobsSha256"]==sha((REPORT/"jobs.json").read_bytes()),"锁定输入改变")
    index={x["path"]:x for x in read(REPORT/"artifact-index.json")} if not archive else {}; rows=[]; records={}; metrics={}; ids=[x["imageId"] for x in lock["images"]]; seen=defaultdict(list)
    for rd in (1,2,3):
      for j in jobs:
       for b in BACKENDS:
        rel=f"round-{rd}/{j['key']}-{j['precision']}-{b}.json"
        if archive: raw=(WORK/rel).read_bytes(); binding=json.loads((WORK/rel.replace(".json","-binding.json")).read_text(encoding="utf-8"))
        else:
          entry=index["evidence/"+rel+".gz"]; compressed=(REPORT/("evidence/"+rel+".gz")).read_bytes(); require(sha(compressed)==entry["compressedSha256"],"压缩摘要错误"); raw=gzip.decompress(compressed); require(len(raw)==entry["bytes"] and sha(raw)==entry["sha256"],"解压摘要错误"); binding={"round":rd,"protocolSha256":lock["protocolSha256"],"resultSha256":sha(raw)}
        v=json.loads(raw); timestamp=validate_record(v,binding,raw,j,b,rd,lock); run=f"{j['precision']}-{b}"; require(all(old_sha!=sha(raw) and old_time<timestamp for old_sha,old_time in seen[run]),"轮次记录复用或时间倒序"); seen[run].append((sha(raw),timestamp)); records[(rd,j["precision"],b)]=v; metrics[(rd,j["precision"],b)]=evaluate_coco(read(ANNOTATIONS),v["predictions"],ids); rows.append({"round":rd,"precision":j["precision"],"backend":b,"sha256":sha(raw),"metrics":metrics[(rd,j["precision"],b)],"performance":v["performance"],"artifacts":v["artifacts"]})
    for row in rows:
      k=(row["round"],row["precision"],row["backend"]); ref=(row["round"],"fp32",row["backend"]); row["apDeltaPoints"]=(row["metrics"]["metrics"]["AP"]-metrics[ref]["metrics"]["AP"])*100; row["retention"]=parity(records[ref]["predictions"],records[k]["predictions"],ids,.5); row["strictRetention"]=parity(records[ref]["predictions"],records[k]["predictions"],ids,.99); row["qualityGatePassed"]=quality_pass(row["apDeltaPoints"],row["retention"]["fraction"]); row["warmInferenceMedianMs"]=statistics.median(x["timings"]["inferenceMs"] for x in records[k]["images"][1:])
    candidates=[]
    for p in ("fp16","w8a32"):
      selected=[x for x in rows if x["precision"]==p]; j=next(x for x in jobs if x["precision"]==p); base=next(x for x in jobs if x["precision"]=="fp32"); candidates.append({"key":"ppyolo-tiny-320","precision":p,"bytes":j["bytes"],"sha256":j["sha256"],"sizeReduction":1-j["bytes"]/base["bytes"],"qualityGatePassed":len(selected)==6 and all(x["qualityGatePassed"] for x in selected),"minimumApDeltaPoints":min(x["apDeltaPoints"] for x in selected),"minimumRetention":min(x["retention"]["fraction"] for x in selected)})
    for item in candidates: item["releaseDecision"]="eligible-for-release-review" if item["qualityGatePassed"] else "labs-only"
    result={"protocolSha256":lock["protocolSha256"],"sdkSha256":lock["sdkSha256"],"inputsLockSha256":sha((REPORT/"inputs.lock.json").read_bytes()),"environment":{**lock["environment"],"gpuAdapter":lock["gpuAdapter"]},"browserRunCount":len(rows),"qualityGate":protocol["qualityGate"],"candidates":candidates,"rows":rows,"qualityGatePassed":all(x["qualityGatePassed"] for x in candidates)}; (REPORT/"summary.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if archive:
      idx=[]
      for rd in (1,2,3):
       for j in jobs:
        for b in BACKENDS:
         rel=f"round-{rd}/{j['key']}-{j['precision']}-{b}.json"; data=(WORK/rel).read_bytes(); gz=gzip.compress(data,mtime=0); p=REPORT/"evidence"/(rel+".gz"); p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(gz); idx.append({"path":"evidence/"+rel+".gz","bytes":len(data),"sha256":sha(data),"compressedSha256":sha(gz)})
      (REPORT/"artifact-index.json").write_text(json.dumps(idx,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if (REPORT/"artifact-index.json").exists():
      bound=["protocol.json","jobs.json","inputs.lock.json","summary.json","artifact-index.json","cpu-validation.json"]
      receipt={"files":{name:sha((REPORT/name).read_bytes()) for name in bound},"evidence":read(REPORT/"artifact-index.json"),"browserRunCount":len(rows)}
      (REPORT/"quality-receipt.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return result
if __name__=="__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--archive",action="store_true"); summarize(parser.parse_args().archive)
