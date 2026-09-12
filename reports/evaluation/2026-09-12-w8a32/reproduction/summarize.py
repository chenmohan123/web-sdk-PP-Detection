from pathlib import Path
import json,statistics,sys,gzip,hashlib,shutil
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation.matching import compare_detections
summary={'date':'2026-09-12','status':'labs','sdkVersion':'0.3.1','runs':{},'performance':{},'parity':{}}
def percentile(values,p):
 values=sorted(values);x=(len(values)-1)*p;a=int(x);return values[a]+(values[min(a+1,len(values)-1)]-values[a])*(x-a)
for backend in ['wasm','webgpu']:
 summary['performance'][backend]={}
 for name in ['fp32','w8a32']:
  rows=[]
  for n in [1,2,3]:
   key=f'{backend}-{name}-{n}';r=json.loads((OUT/'browser'/f'{key}.json').read_text(encoding='utf-8'));c=json.loads((OUT/'browser'/f'{key}-coco.json').read_text(encoding='utf-8'))
   assert r['status']=='passed';assert r['runtime']['backend']==backend;assert r['runtime']['fallbacks']==[]
   row={'AP':c['metrics']['AP']*100,'sessionMs':r['loadTimings']['sessionMs'],'firstImageMs':r['performance']['firstImageMs'],'warmCount':len(r['images'])-1}
   for metric in ['preprocessMs','inferenceMs','totalMs']:
    values=[i['timings'][metric] for i in r['images'][1:]];row[metric]={'median':statistics.median(values),'p90':percentile(values,.9)}
   row['wallClockMs']={'median':r['performance']['warmRuns']['medianMs'],'p90':r['performance']['warmRuns']['p90Ms']}
   summary['runs'][key]=row;rows.append(row)
  result={'AP':[r['AP'] for r in rows],'sessionMs':statistics.median(r['sessionMs'] for r in rows),'firstImageMs':statistics.median(r['firstImageMs'] for r in rows)}
  for metric in ['preprocessMs','inferenceMs','totalMs','wallClockMs']:result[metric]={k:statistics.median(r[metric][k] for r in rows) for k in ['median','p90']}
  summary['performance'][backend][name]=result
 left=json.loads((OUT/'browser'/f'{backend}-fp32-1.json').read_text(encoding='utf-8'))['predictions'];right=json.loads((OUT/'browser'/f'{backend}-w8a32-1.json').read_text(encoding='utf-8'))['predictions'];ids=sorted(set(x['image_id'] for x in left+right));details=[]
 for imageid in ids:
  p=compare_detections([x for x in left if x['image_id']==imageid],[x for x in right if x['image_id']==imageid],score_threshold=.5,iou_threshold=.5);p['imageId']=imageid;details.append(p)
 result={k:sum(p[k] for p in details) for k in ['referenceCount','candidateCount','matchedCount','unmatchedReferenceCount','unmatchedCandidateCount']}
 result.update({k:max(p[k] or 0 for p in details) for k in ['maxScoreDelta','maxBboxDeltaPixels']});summary['parity'][backend]=result
 (OUT/f'{backend}-parity.json').write_text(json.dumps({'scoreThreshold':.5,'iouThreshold':.5,**result,'images':details},ensure_ascii=False,indent=2),encoding='utf8')
summary['models']={}
for name in ['picodet','ppyoloe']:
 r=json.loads((OUT/'artifacts'/name/'conversion.json').read_text(encoding='utf-8'));summary['models'][name]={'source':r['source'],'output':r['output'],'reductionPercent':100*(1-r['output']['bytes']/r['source']['bytes']),'quantizedWeightTensors':r['quantizedWeightTensors'],'excludedNodes':r['excludedNodes']}
summary['python']={}
for kind in ['fp32','w8a32']:
 r=json.loads((OUT/'python'/f'{kind}-runtime.json').read_text(encoding='utf-8'));summary['python'][kind]={'AP':r['evaluation']['metrics']['AP']*100,'predictionCount':r['evaluation']['predictionCount']}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(summary,ensure_ascii=False))
