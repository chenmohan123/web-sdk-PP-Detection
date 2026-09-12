from pathlib import Path
import json,sys,subprocess,os,statistics
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation import evaluate_coco
annotations=ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json';data=json.loads(annotations.read_text(encoding='utf-8'));ids=[x['id'] for x in data['images']]
(OUT/'browser').mkdir(exist_ok=True);summary={}
for backend in ['webgpu','wasm']:
 for round_no in [1,2,3]:
  for name in ['fp32','w8a32']:
   key=f'{backend}-{name}-{round_no}';path=OUT/'browser'/f'{key}.json';manifest=OUT/'artifacts/ppyoloe'/('fp32-manifest.json' if name=='fp32' else 'manifest.json');model=ROOT/'.tmp/phase2/ppyoloe-plus-s-candidate.onnx' if name=='fp32' else OUT/'artifacts/ppyoloe/ppyoloe-w8a32.onnx'
   cmd=['node',str(OUT/'browser-probe.mjs'),'--model',str(model),'--manifest',str(manifest),'--annotations',str(annotations),'--image-root',str(ROOT/'.tmp/phase2/dataset/images'),'--backend',backend,'--output',str(path)]
   print('开始',key,flush=True)
   with (path.with_suffix('.log')).open('w',encoding='utf8') as log:run=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=300,env={**os.environ,'PLAYWRIGHT_BROWSERS_PATH':str(ROOT/'.tmp/dependencies-compatible-browsers')})
   r=json.loads(path.read_text(encoding='utf-8'));entry={'status':r['status'],'exitCode':run.returncode}
   if r['status']=='passed':
    coco=evaluate_coco(data,r['predictions'],ids);(path.with_name(key+'-coco.json')).write_text(json.dumps(coco,indent=2),encoding='utf8');entry.update({'AP':coco['metrics']['AP']*100,'inferenceMs':statistics.median(i['timings']['inferenceMs'] for i in r['images'][1:]),'warmTotalMs':r['performance']['warmRuns']['medianMs']})
   else:entry['error']=r.get('error',r.get('reason'))
   summary[key]=entry;(OUT/'browser/summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8');print(key,json.dumps(entry,ensure_ascii=False),flush=True)
   if entry['status']!='passed':raise RuntimeError(key+' 浏览器验证失败')
   if name=='w8a32' and entry['AP']<summary[f'{backend}-fp32-{round_no}']['AP']-1:raise RuntimeError('质量下降超过初筛 1 AP，停止重复性能测试')
