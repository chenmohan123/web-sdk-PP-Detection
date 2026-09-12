from pathlib import Path
import sys,json,collections
import numpy as np,onnx,onnxruntime as ort,cv2
ROOT=Path(r"F:/git/00_chenmohan/github/web-sdk-PP-Detection");OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from ppyoloe.inference import preprocess_image
base=onnx.load(OUT/'models/fp32-prepared.onnx')
convs=[n for n in base.graph.node if n.op_type=='Conv'];names=[n.output[0] for n in convs]
data=json.loads((ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text());image=data['images'][0]
rgb=cv2.cvtColor(cv2.imread(str(ROOT/'.tmp/phase2/dataset/images'/image['file_name'])),cv2.COLOR_BGR2RGB)
x=preprocess_image(rgb,model='picodet',size=320)
outputs={}
for kind in ['fp32-prepared','qdq-s8s8']:
 m=onnx.load(OUT/'models'/f'{kind}.onnx');m.graph.output.extend([onnx.helper.make_tensor_value_info(n,onnx.TensorProto.FLOAT,None) for n in names]);o=ort.SessionOptions();o.intra_op_num_threads=1;o.log_severity_level=3
 session=ort.InferenceSession(m.SerializeToString(),o,providers=['CPUExecutionProvider']);outputs[kind]=session.run(names,{'image':x});del session
result=[]
for node,a,b in zip(convs,outputs['fp32-prepared'],outputs['qdq-s8s8']):
 diff=a-b; rms=float(np.sqrt(np.mean(a*a))); nrms=float(np.sqrt(np.mean(diff*diff)))/(rms+1e-12)
 result.append({'node':node.name,'output':node.output[0],'shape':list(a.shape),'fp32Range':[float(a.min()),float(a.max())],'fp32P001P999':[float(y) for y in np.quantile(a,[.001,.999])],'int8Range':[float(b.min()),float(b.max())],'relativeRmsError':nrms,'maxAbsError':float(np.max(np.abs(diff)))})
(OUT/'layer-diagnostics.json').write_text(json.dumps({'imageId':image['id'],'layers':result},indent=2),encoding='utf8')
print(json.dumps(result[:14]))
print('last',json.dumps(result[-8:]))
