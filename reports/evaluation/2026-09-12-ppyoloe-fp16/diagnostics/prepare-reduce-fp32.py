import onnx,json,hashlib,numpy as np
from pathlib import Path
from onnxruntime.transformers.float16 import convert_float_to_float16,DEFAULT_OP_BLOCK_LIST
from onnxruntime.transformers.onnx_model import OnnxModel
p=Path('.tmp/fp16-2026-09-12')
for precision,dtype in [('fp16',10),('fp32',1)]:
 nodes=[onnx.helper.make_node('Cast',['image'],['cast'],to=dtype),onnx.helper.make_node('ReduceMean',['cast'],['mean'],axes=[2,3],keepdims=1),onnx.helper.make_node('Cast',['mean'],['output'],to=1)]
 g=onnx.helper.make_graph(nodes,'归约溢出诊断',[onnx.helper.make_tensor_value_info('image',1,[1,3,640,640])],[onnx.helper.make_tensor_value_info('output',1,[1,3,1,1])])
 m=onnx.helper.make_model(g,opset_imports=[onnx.helper.make_opsetid('',11)]);onnx.save(m,str(p/f'minimal-mean-{precision}.onnx'))
source=Path('.tmp/phase2/ppyoloe-plus-s-candidate.onnx')
assert hashlib.sha256(source.read_bytes()).hexdigest()=='d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c'
m=convert_float_to_float16(onnx.load(str(source)),keep_io_types=True,op_block_list=DEFAULT_OP_BLOCK_LIST+['ReduceMean'])
OnnxModel(m).topological_sort();onnx.checker.check_model(m,full_check=True)
target=p/'ppyoloe-plus-s-640-fp16-reduce-fp32.onnx';onnx.save(m,str(target))
report={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'candidateBytes':target.stat().st_size,'keepIoTypes':True,'additionalOpBlockList':['ReduceMean'],'checker':'passed'}
(p/'conversion-reduce-fp32.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
manifest=json.loads((p/'manifest.json').read_text(encoding='utf-8'));manifest['model']['version']='0.1.0-fp16-probe.2'
v=manifest['variants'][0];v['bytes']=target.stat().st_size;s=v['sources'][0];s['bytes']=target.stat().st_size;s['path']=target.name;s['sha256']=report['candidateSha256'];s['revision']=report['candidateSha256']
(p/'manifest-reduce-fp32.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
