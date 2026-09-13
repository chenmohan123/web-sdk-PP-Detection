"""汇总真实输出并归档原始证据；不把初步浏览器 smoke 当完整兼容性验收。"""
from pathlib import Path
import gzip
import hashlib
import json
import sys
import numpy as np
import onnx

root=Path.cwd(); report=Path(__file__).resolve().parents[1]; work=root/'.tmp/sod-20260913'
sys.path.insert(0,str(root/'tools/model-pipeline'))
from evaluation import compare_detections

def read(name): return json.loads((work/name).read_text(encoding='utf-8'))
def digest(path): return {'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
def aggregate(rows):
    return {'imageCount':len(rows),'matchedCount':sum(r['matchedCount'] for r in rows),'unmatchedReferenceCount':sum(r['unmatchedReferenceCount'] for r in rows),'unmatchedCandidateCount':sum(r['unmatchedCandidateCount'] for r in rows),'emptyImageCount':sum(r['referenceCount']==r['candidateCount']==0 for r in rows),'maxScoreDelta':max((r['maxScoreDelta'] for r in rows if r['maxScoreDelta'] is not None),default=None),'maxBboxDeltaPixels':max((r['maxBboxDeltaPixels'] for r in rows if r['maxBboxDeltaPixels'] is not None),default=None)}
paddle=read('paddle-reference.json'); py=read('onnx-runtime.json'); pillow=read('pillow-runtime.json')
parity=aggregate(paddle['comparison']['images'])
assert parity['imageCount']==64 and parity['unmatchedReferenceCount']==parity['unmatchedCandidateCount']==0
preds=read('pillow-predictions.json'); browser={}
for backend in ['wasm','webgpu']:
    b=read(f'browser-{backend}.json'); assert b['status']=='passed'
    comparisons=[]
    for i in b['images']:
        iid=i['imageId']
        comparisons.append({'imageId':iid,**compare_detections([p for p in preds if p['image_id']==iid],[p for p in b['predictions'] if p['image_id']==iid],iou_threshold=.99,score_threshold=.5)})
    browser[backend]={'status':b['status'],'runtime':b['runtime'],'environment':b['environment'],'versions':b['runtimeVersions'],'performance':b['performance'],'comparison':{'iouThreshold':.99,'scoreThreshold':.5,**aggregate(comparisons)},'evidence':f'evidence/browser-{backend}.json.gz'}
    (work/f'browser-{backend}-parity.json').write_text(json.dumps(comparisons,indent=2)+'\n',encoding='utf-8')
model=work/'ppyoloe-sod-l-640-candidate.onnx';m=onnx.load(model);manifest=read('candidate-manifest.json')
constant_elements=sum(int(np.prod(a.t.dims)) for n in m.graph.node if n.op_type=='Constant' for a in n.attribute if a.name=='value')
model_info={**digest(model),'opset':11,'inputs':[manifest['input']],'outputs':manifest['outputs'],'parameterCount':None,'constantTensorElements':constant_elements,'initializerElements':sum(int(np.prod(t.dims)) for t in m.graph.initializer),'parameterCountNote':'导出图使用 Constant 存储权重；常量元素包含非训练参数，不能直接作为可训练参数量'}
summary={'candidate':'ppyoloe-sod-l-640-coco','checkedAt':'2026-09-13','status':'candidate','upstreamEvidence':'sources.lock.json','environment':read('raw-inspection.json')['environment'],'onnx':model_info,'rawOnnx':read('raw-inspection.json'),'preparation':read('preparation.json'),'pythonReference':{'imageCount':64,'annotationsSha256':paddle['annotationsSha256'],'iouThreshold':.99,'scoreThreshold':.5,'comparison':parity,'paddleMetrics':paddle['evaluation']['metrics'],'onnxMetrics':py['evaluation']['metrics'],'pillowMetrics':pillow['evaluation']['metrics'],'medianInferenceMs':py['medianInferenceMs'],'evidence':'evidence/paddle-reference.json.gz'},'browserSmoke':browser,'remaining':['完整 WASM/WebGPU × main/Worker 验证','取消、释放后调用、显式来源与后端失败路径的候选专项核验','至少一台移动设备的本模型验证','正式权重分发审查和来源锁定','独立小目标数据集与普通 PP-YOLOE+ L 的公平对照'], 'decision':'继续评估，暂不进入稳定模型清单。FP32 约为现有 PP-YOLOE+ S 的 10.8 倍；初步 smoke 不足以决定移动端接入。'}
(report/'ppyoloe-sod-conversion.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
files=['export.log','paddle2onnx.log','build.log','onnx-runtime.json','pillow-runtime.json','paddle-reference.json','onnx-predictions.json','pillow-predictions.json','paddle-predictions.json','browser-annotations.json','candidate-manifest.json','browser-wasm.json','browser-webgpu.json','browser-wasm-parity.json','browser-webgpu-parity.json']
index=[]
for name in files:
    b=(work/name).read_bytes();p=report/'evidence'/(name+'.gz');p.parent.mkdir(exist_ok=True);p.write_bytes(gzip.compress(b,mtime=0));index.append({'path':'evidence/'+name+'.gz','uncompressedBytes':len(b),'uncompressedSha256':hashlib.sha256(b).hexdigest(),**digest(p)})
(report/'evidence-index.json').write_text(json.dumps(index,indent=2)+'\n',encoding='utf-8')
c=json.loads((report/'candidates.json').read_text(encoding='utf-8'));c['candidates'][2]['estimatedBytes']['fp32']=model_info['bytes'];(report/'candidates.json').write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'model':model_info,'python':parity,'browser':{k:{'comparison':v['comparison'],'performance':v['performance'],'versions':v['versions']} for k,v in browser.items()}},ensure_ascii=False,indent=2))
