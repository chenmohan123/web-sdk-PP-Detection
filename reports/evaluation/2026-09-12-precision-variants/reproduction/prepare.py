from pathlib import Path
import sys,json,hashlib,copy,collections
import onnx,numpy as np
from onnxruntime.transformers.float16 import convert_float_to_float16,DEFAULT_OP_BLOCK_LIST
from onnxruntime.transformers.onnx_model import OnnxModel
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
recipes=[('picodet',ROOT/'models/pp-detection/picodet-l-320-fp32.onnx',ROOT/'models/pp-detection/manifest.json',[],['Cast_5']),('ppyoloe',ROOT/'.tmp/phase2/ppyoloe-plus-s-candidate.onnx',ROOT/'models/ppyoloe-plus-s-640/manifest.json',['ReduceMean'],[])]
for name,source,manifest,blocked_ops,blocked_nodes in recipes:
 directory=OUT/'artifacts'/name;directory.mkdir(parents=True,exist_ok=True);target=directory/f'{name}-fp16.onnx'
 original=json.loads(manifest.read_text(encoding='utf-8'));v=original['variants'][0]
 assert hashlib.sha256(source.read_bytes()).hexdigest()==v['sha256']
 blocks=list(dict.fromkeys([*DEFAULT_OP_BLOCK_LIST,*blocked_ops]))
 model=convert_float_to_float16(onnx.load(source),keep_io_types=True,op_block_list=blocks,node_block_list=blocked_nodes)
 OnnxModel(model).topological_sort();onnx.checker.check_model(model,full_check=True)
 if target.exists():raise FileExistsError(target)
 onnx.save(model,target);sha=hashlib.sha256(target.read_bytes()).hexdigest()
 r={'sourceSha256':v['sha256'],'sourceBytes':source.stat().st_size,'candidateSha256':sha,'candidateBytes':target.stat().st_size,'opBlockList':blocks,'nodeBlockList':blocked_nodes,'keepIoTypes':True,'fullOnnxCheck':True}
 (directory/'fp16-conversion.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')
 for kind in ['fp32','fp16','w8a32']:
  m=copy.deepcopy(original)
  if kind=='fp32':
   mv=m['variants'][0]
  elif kind=='w8a32':
   m=json.loads((ROOT/'.tmp/w8a32-artifacts/2026-09-12'/name/'manifest.json').read_text(encoding='utf-8'));mv=m['variants'][0]
  else:
   mv=m['variants'][0];mv.update(id='fp16',filename=target.name,precision='fp16',quantization='mixed-fp16-sensitive-ops-fp32',bytes=target.stat().st_size,sha256=sha,status='labs')
   mv['sources']=[{'kind':'custom','repository':'local://precision-release','revision':sha,'path':target.name,'downloadUrl':'http://localhost/model/model.onnx','bytes':target.stat().st_size,'sha256':sha}]
   m.update(status='labs',defaultVariant='fp16',defaultSource='custom');m['model']['version']+='-fp16-validation.1'
  m['postprocessing']['scoreThreshold']=.001;m['postprocessing']['iouThreshold']=1
  m['variants']=[mv]
  (directory/f'{kind}-manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf-8')
 print(name,json.dumps(r),flush=True)
