from pathlib import Path
import json,sys,subprocess,os,statistics
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation import evaluate_coco
annotations=ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json';dataset=json.loads(annotations.read_text(encoding='utf-8'));ids=[i['id'] for i in dataset['images']]
(OUT/'browser').mkdir(exist_ok=True);summary={}
for repeat in [1,2,3]:
 for backend in ['webgpu','wasm']:
  for name in ['picodet','ppyoloe']:
   for kind in ['fp32','fp16','w8a32']:
    key=f'{name}-{backend}-{kind}-{repeat}';target=OUT/'browser'/f'{key}.json'
    if kind=='fp32':model=ROOT/('models/pp-detection/picodet-l-320-fp32.onnx' if name=='picodet' else '.tmp/phase2/ppyoloe-plus-s-candidate.onnx')
    elif kind=='w8a32':model=ROOT/'.tmp/w8a32-artifacts/2026-09-12'/name/f'{name}-w8a32.onnx'
    else:model=OUT/'artifacts'/name/f'{name}-fp16.onnx'
    cmd=['node',str(OUT/'browser-probe.mjs'),'--model',str(model),'--manifest',str(OUT/'artifacts'/name/f'{kind}-manifest.json'),'--annotations',str(annotations),'--image-root',str(ROOT/'.tmp/phase2/dataset/images'),'--backend',backend,'--output',str(target)]
    print('开始',key,flush=True)
    with target.with_suffix('.log').open('w',encoding='utf-8') as log:r=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=300,env={**os.environ,'PLAYWRIGHT_BROWSERS_PATH':str(ROOT/'.tmp/dependencies-compatible-browsers')})
    result=json.loads(target.read_text(encoding='utf-8'));entry={'status':result['status'],'exitCode':r.returncode}
    if result['status']=='passed':
     metrics=evaluate_coco(dataset,result['predictions'],ids);target.with_name(key+'-coco.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
     entry.update(AP=metrics['metrics']['AP']*100,inferenceMs=statistics.median(i['timings']['inferenceMs'] for i in result['images'][1:]),warmTotalMs=result['performance']['warmRuns']['medianMs'])
    else:entry['error']=result.get('error',result.get('reason'))
    summary[key]=entry;(OUT/'browser/summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8');print(key,json.dumps(entry,ensure_ascii=False),flush=True)
    if entry['status']!='passed' or r.returncode!=0:raise RuntimeError(key+' 运行失败')
    if kind!='fp32' and entry['AP']<summary[f'{name}-{backend}-fp32-{repeat}']['AP']-.5:raise RuntimeError(key+' AP 下降超过 0.5，先定位后继续')
