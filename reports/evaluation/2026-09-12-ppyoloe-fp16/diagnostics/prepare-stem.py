"""导出输入、首层卷积及归一化边界的最小数值诊断图。"""
import json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort
p=Path('.tmp/fp16-2026-09-12')
source=p/'ppyoloe-plus-s-640-fp16.onnx'
outputs=['graph_input_cast_0','conv2d_0.tmp_0','batch_norm_0.tmp_2','swish_0.tmp_0','swish_1.tmp_0']
reports={}
for name,cuts in [('stem-boundaries',outputs),('stem-fused',['swish_1.tmp_0'])]:
 target=p/(name+'.onnx')
 onnx.utils.extract_model(str(source),str(target),['image'],cuts)
 session=ort.InferenceSession(str(target),providers=['CPUExecutionProvider'])
 rows=[]
 for fill in [0,1]:
  result=session.run(None,{'image':np.full((1,3,640,640),fill,np.float32)})
  rows.append({'fill':fill,'outputs':{key:{'min':float(v.min()),'max':float(v.max()),'mean':float(v.astype(np.float64).mean()),'sample':v.reshape(-1)[:16].tolist()} for key,v in zip(cuts,result)}})
 reports[name]=rows
(p/'stem-cpu.json').write_text(json.dumps(reports,indent=2)+'\n',encoding='utf-8')
