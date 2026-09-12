from pathlib import Path
import json,sys,statistics,hashlib,gzip,collections
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation.matching import compare_detections
annotations=json.loads((ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text());ids=[x['id'] for x in annotations['images']]
summary={'date':'2026-09-12','baselineSdkVersion':'0.3.1','modelVersion':'1.0.1','calibrationImages':128,'evaluationImages':64,'groundTruthCount':len(annotations['annotations']),'status':'labs','runs':{},'comparison':{},'parity':{}}
def pct(a,p):
 s=sorted(a);i=(len(s)-1)*p;lo=int(i);return s[lo]+(s[min(lo+1,len(s)-1)]-s[lo])*(i-lo)
for path in sorted((OUT/'browser').glob('*.json')):
 if path.name.startswith('summary') or path.name.endswith('-coco.json'):continue
 r=json.loads(path.read_text());key=path.stem
 row={'status':r['status'],'path':'browser/'+path.name}
 if r['status']=='passed':
  coco=json.loads(path.with_name(path.stem+'-coco.json').read_text());row.update({'AP':coco['metrics']['AP']*100,'AP50':coco['metrics']['AP50']*100,'APSmall':coco['metrics']['APSmall']*100,'sessionMs':r['loadTimings']['sessionMs'],'firstImageMs':r['performance']['firstImageMs'],'sdk':r['runtimeVersions']['sdk'],'modelSha256':r['artifacts']['model']['sha256'],'sdkSha256':r['artifacts']['sdk']['sha256'],'actualBackend':r['runtime']['backend'],'precision':r['runtime']['precision'],'fallbacks':r['runtime']['fallbacks']})
  for t in ['preprocessMs','inferenceMs','totalMs']:
   a=[x['timings'][t] for x in r['images'][1:]];row[t]={'median':statistics.median(a),'p90':pct(a,.9)}
  row['wallClockMs']={'median':r['performance']['warmRuns']['medianMs'],'p90':r['performance']['warmRuns']['p90Ms']}
 summary['runs'][key]=row
for backend in ['wasm','webgpu']:
 summary['comparison'][backend]={}
 for kind in ['fp32','weight-only-stem-fp32']:
  rows=[summary['runs'][f'{backend}-{kind}-{i}'] for i in range(2,5)]
  assert all(r['status']=='passed' for r in rows)
  aggregate={'rounds':[2,3,4],'AP':[r['AP'] for r in rows]}
  for metric in ['preprocessMs','inferenceMs','totalMs','wallClockMs']:
   aggregate[metric]={s:statistics.median(r[metric][s] for r in rows) for s in ['median','p90']}
  for metric in ['sessionMs','firstImageMs']:aggregate[metric]=statistics.median(r[metric] for r in rows)
  summary['comparison'][backend][kind]=aggregate
 fp=json.loads((OUT/'browser'/f'{backend}-fp32-2.json').read_text())['predictions'];weight=json.loads((OUT/'browser'/f'{backend}-weight-only-stem-fp32-2.json').read_text())['predictions']
 details=[]
 for imageid in ids:
  p=compare_detections([d for d in fp if d['image_id']==imageid],[d for d in weight if d['image_id']==imageid],score_threshold=.5,iou_threshold=.5);p['imageId']=imageid;details.append(p)
 agg={k:sum(p[k] for p in details) for k in ['referenceCount','candidateCount','matchedCount','unmatchedReferenceCount','unmatchedCandidateCount']}
 for k in ['maxScoreDelta','maxBboxDeltaPixels']:agg[k]=max(p[k] or 0 for p in details)
 agg.update({'iouThreshold':.5,'scoreThreshold':.5,'images':details});(OUT/f'{backend}-weight-parity.json').write_text(json.dumps(agg,ensure_ascii=False,indent=2),encoding='utf8')
 summary['parity'][backend]={k:v for k,v in agg.items() if k!='images'}
summary['sourceSha256']=hashlib.sha256((ROOT/'models/pp-detection/picodet-l-320-fp32.onnx').read_bytes()).hexdigest()
summary['weightCandidateSha256']=hashlib.sha256((OUT/'models/weight-only-stem-fp32.onnx').read_bytes()).hexdigest()
summary['size']={'fp32':23243834,'W8A32':6117685,'reductionPercent':(1-6117685/23243834)*100}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:summary[k] for k in ['comparison','parity','size']},ensure_ascii=False))
