from pathlib import Path
import json,hashlib,collections
import onnx,numpy as np
from onnx import numpy_helper,helper
OUT=Path(__file__).parent
m=onnx.load(OUT/'models/fp32-prepared.onnx');initializers={x.name:x for x in m.graph.initializer};nodes=[];quantized=set();weight_errors=[]
# 本候选仅压缩权重；激活和卷积计算仍为 FP32，不能当成 INT8 推理加速。
for n in m.graph.node:
 if n.op_type=='Conv' and n.name not in {'Conv_0','Conv_1'}:
  wname=n.input[1]
  if wname not in quantized:
   w=numpy_helper.to_array(initializers[wname]);axis=tuple(range(1,w.ndim));maxabs=np.max(np.abs(w),axis=axis);scale=np.maximum(maxabs/127,np.finfo(np.float32).tiny).astype(np.float32);view=scale.reshape((-1,)+(1,)*(w.ndim-1));q=np.clip(np.rint(w/view),-127,127).astype(np.int8)
   qname=wname+'_w8';sname=wname+'_w8_scale';zname=wname+'_w8_zero';quantized.add(wname)
   m.graph.initializer.extend([numpy_helper.from_array(q,qname),numpy_helper.from_array(scale,sname),numpy_helper.from_array(np.zeros(scale.shape,dtype=np.int8),zname)])
   nodes.append(helper.make_node('DequantizeLinear',[qname,sname,zname],[wname],name=wname+'_W8A32_Dequantize',axis=0))
   weight_errors.append({'weight':wname,'maxAbsError':float(np.max(np.abs(w-q.astype(np.float32)*view)))})
 nodes.append(n)
keep=[x for x in m.graph.initializer if x.name not in quantized];m.graph.ClearField('initializer');m.graph.initializer.extend(keep);m.graph.ClearField('node');m.graph.node.extend(nodes)
onnx.checker.check_model(m,full_check=True);target=OUT/'models/weight-only-stem-fp32.onnx'
if target.exists():raise FileExistsError(target)
onnx.save(m,target)
r={'status':'converted','quantization':'W8A32-per-channel-symmetric','activation':'FP32','weights':'INT8 except Conv_0/Conv_1','excludedNodes':['Conv_0','Conv_1'],'quantizedWeightTensors':len(quantized),'fullOnnxCheck':True,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'opsets':{x.domain:x.version for x in m.opset_import},'operators':dict(collections.Counter(n.op_type for n in m.graph.node)),'weightErrors':weight_errors}
(OUT/'conversion-weight-only.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in r.items() if k not in {'weightErrors','operators'}}))
