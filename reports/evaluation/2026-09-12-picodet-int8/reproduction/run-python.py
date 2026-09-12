from pathlib import Path
import sys,json,subprocess,os
ROOT=Path(r"F:/git/00_chenmohan/github/web-sdk-PP-Detection");OUT=Path(__file__).parent
(OUT/'python').mkdir(exist_ok=True)
models={'fp32':ROOT/'models/pp-detection/picodet-l-320-fp32.onnx','fp32-prepared':OUT/'models/fp32-prepared.onnx','qdq-s8s8':OUT/'models/qdq-s8s8.onnx','qoperator-u8s8':OUT/'models/qoperator-u8s8.onnx'}
summary={}
for name,model in models.items():
    cmd=[sys.executable,str(ROOT/'tools/model-pipeline/ppyoloe/inference.py'),'--model-kind','picodet','--model',str(model),'--annotations',str(ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'),'--images-dir',str(ROOT/'.tmp/phase2/dataset/images'),'--predictions',str(OUT/'python'/f'{name}-predictions.json'),'--report',str(OUT/'python'/f'{name}-runtime.json'),'--threads','1']
    with (OUT/'python'/f'{name}.log').open('w',encoding='utf-8') as log:
        run=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONUTF8':'1'},timeout=240)
    if run.returncode:summary[name]={'status':'failed','exitCode':run.returncode}
    else:
        r=json.loads((OUT/'python'/f'{name}-runtime.json').read_text());summary[name]={'status':'passed','evaluation':r['evaluation'],'medianInferenceMs':r['medianInferenceMs'],'bytes':r['modelBytes']}
    print(name,json.dumps(summary[name],ensure_ascii=False),flush=True)
(OUT/'python/summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
