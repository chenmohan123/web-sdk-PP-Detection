from pathlib import Path
import sys,json,hashlib,shutil
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from float16_models import convert,PROFILES
result={}
for name in ['picodet','ppyoloe']:
 source=ROOT/('models/pp-detection/picodet-l-320-fp32.onnx' if name=='picodet' else '.tmp/phase2/ppyoloe-plus-s-candidate.onnx');sha,ops,nodes=PROFILES[name]
 target=OUT/'rebuilt'/f'{name}-fp16.onnx';r=convert(source,target,expected_sha256=sha,extra_blocked_ops=ops,blocked_nodes=nodes)
 original=OUT/'artifacts'/name/f'{name}-fp16.onnx';assert r['candidateSha256']==hashlib.sha256(original.read_bytes()).hexdigest()
 (OUT/'artifacts'/name/'fp16-conversion.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');result[name]={'sha256':r['candidateSha256'],'bytes':r['candidateBytes'],'matchesEvaluatedModel':True}
 namespace,version=('picodet-l-320','1.0.2') if name=='picodet' else ('ppyoloe-plus-s-640','0.1.1')
 shutil.copyfile(OUT/'artifacts'/name/'fp16-conversion.json',OUT/'upload'/namespace/version/'fp16-conversion.json')
 print(name,json.dumps(result[name]),flush=True)
(OUT/'report/reproduction-verification.json').write_text(json.dumps({'status':'passed','models':result},ensure_ascii=False,indent=2),encoding='utf-8')
