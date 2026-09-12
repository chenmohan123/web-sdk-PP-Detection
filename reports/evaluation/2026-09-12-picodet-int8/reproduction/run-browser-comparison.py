from pathlib import Path
import sys,json,subprocess,os,time,statistics
ROOT=Path(r"F:/git/00_chenmohan/github/web-sdk-PP-Detection");OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation import evaluate_coco
annotations=json.loads((ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text());ids=[x['id'] for x in annotations['images']]
(OUT/'browser').mkdir(exist_ok=True)
summary={}
for backend in ['wasm','webgpu']:
 for round_no,name in [(r,n) for r in range(2,5) for n in ['fp32','weight-only-stem-fp32']]:
    key=f'{backend}-{name}-{round_no}';target=OUT/'browser'/f'{key}.json';model=ROOT/'models/pp-detection/picodet-l-320-fp32.onnx' if name=='fp32' else OUT/'models'/f'{name}.onnx'
    cmd=['node',str(OUT/'browser-probe.mjs'),'--model',str(model),'--manifest',str(OUT/f'{name}-manifest.json'),'--annotations',str(ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'),'--image-root',str(ROOT/'.tmp/phase2/dataset/images'),'--backend',backend,'--output',str(target)]
    print('开始',key,flush=True)
    with (OUT/'browser'/f'{key}.log').open('w',encoding='utf-8') as log:
     run=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=300,env={**os.environ,'PLAYWRIGHT_BROWSERS_PATH':str(ROOT/'.tmp/dependencies-compatible-browsers')})
    r=json.loads(target.read_text());summary[key]={'status':r['status'],'exitCode':run.returncode}
    if r['status']=='passed':
      coco=evaluate_coco(annotations,r['predictions'],ids); (OUT/'browser'/f'{key}-coco.json').write_text(json.dumps(coco,indent=2),encoding='utf-8')
      summary[key].update({'AP':coco['metrics']['AP']*100,'inferenceMs':statistics.median(i['timings']['inferenceMs'] for i in r['images'][1:]),'warmTotalMs':r['performance']['warmRuns']['medianMs']})
    else:summary[key]['error']=r.get('error',r.get('reason'))
    print(key,json.dumps(summary[key],ensure_ascii=False),flush=True)
    (OUT/'browser/summary-comparison.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
