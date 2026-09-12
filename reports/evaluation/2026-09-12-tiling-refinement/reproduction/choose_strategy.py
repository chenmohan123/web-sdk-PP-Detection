"""一次性诊断：官方 COCOeval 重算，在独立集推理前冻结统一策略。"""
from pathlib import Path
import gzip,json,hashlib,sys,importlib.util,datetime
OUT=Path(__file__).resolve().parents[1];ROOT=OUT.parents[2]
BEFORE=OUT.parent/'2026-09-12-tiling'
spec=importlib.util.spec_from_file_location('first_round',BEFORE/'reproduction/summarize.py');first=importlib.util.module_from_spec(spec);spec.loader.exec_module(first)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
data=read(ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json');ids=[i['id'] for i in data['images']]
source=read(OUT/'diagnostic-inputs.json');rows=[];details={}
for run in source['runs']:
    path=OUT/run['file'];assert sha(path)==run['sha256'];raw=json.loads(gzip.decompress(path.read_bytes()));name=run['name'];matches={}
    for mode in ['whole','combined','whole-first','edge-contained','small-additions','confident-anchor']:
        predictions=[]
        for image in raw['images']:
            for d in image['modes'][mode]:
                b=d['box'];predictions.append(dict(image_id=image['imageId'],category_id=raw['categoryIds'][d['classId']],score=d['score'],bbox=[b['x'],b['y'],b['width'],b['height']]))
        metrics=first.evaluate_coco(data,predictions,ids)['metrics'];match=first.operating(data,predictions,ids);matches[mode]=match
        row=dict(name=name,mode=mode,metrics=metrics,operating=match['totals']);rows.append(row)
        if mode not in ['whole','combined']:
            base=next(r for r in rows if r['name']==name and r['mode']=='whole');combined=next(r for r in rows if r['name']==name and r['mode']=='combined')
            additional=match['totals']['smallTp']-base['operating']['smallTp'];original=combined['operating']['smallTp']-base['operating']['smallTp']
            row['smallGainRetention']=additional/original
            row['gates']={'ap':metrics['AP']>=base['metrics']['AP']-.005,'largeAp':metrics['APLarge']>=base['metrics']['APLarge']-.02,'fp':match['totals']['fp']-base['operating']['fp']<=max(10,.2*base['operating']['fp']),'smallGain':additional>=.8*original}
            row['pass']=all(row['gates'].values())
        print(name,mode,'AP',round(metrics['AP']*100,2),'大AP',round(metrics['APLarge']*100,2),'小TP',match['totals']['smallTp'],'FP',match['totals']['fp'],flush=True)
    details[name]=matches
candidates=[]
baseline_small=sum(r['operating']['smallTp'] for r in rows if r['mode']=='whole')
original_gain=sum(r['operating']['smallTp'] for r in rows if r['mode']=='combined')-baseline_small
for mode in ['whole-first','edge-contained','small-additions','confident-anchor']:
    selected=[r for r in rows if r['mode']==mode];candidates.append(dict(mode=mode,passBoth=all(r['pass'] for r in selected),smallTp=sum(r['operating']['smallTp'] for r in selected),fp=sum(r['operating']['fp'] for r in selected)))
passing=[r for r in candidates if r['passBoth']]
if passing: chosen=sorted(passing,key=lambda r:(-r['smallTp'],r['fp']))[0];reason='两模型均通过预设门槛，优先保留小目标收益'
else:
    eligible=[r for r in candidates if r['smallTp']-baseline_small>=original_gain*.5]
    chosen=sorted(eligible,key=lambda r:(r['fp'],-r['smallTp']))[0] if eligible else sorted(candidates,key=lambda r:(-r['smallTp'],r['fp']))[0]
    reason='没有候选同时通过全部门槛；按预设规则选择诊断性候选，不作产品合格声明'
result=dict(frozenAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),chosen=chosen['mode'],productGatesPassed=bool(passing),reason=reason,candidates=candidates,protocolSha256=sha(OUT/'protocol.md'),mergeSha256=sha(OUT/'reproduction/merge.mjs'),diagnosticInputsSha256=sha(OUT/'diagnostic-inputs.json'),rows=rows)
(OUT/'selection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'matches-diagnostic.json.gz').write_bytes(gzip.compress(json.dumps(details,ensure_ascii=False).encode(),mtime=0))
print('已冻结策略：',chosen['mode'],reason,flush=True)
