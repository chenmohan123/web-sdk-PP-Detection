"""PP-YOLO Tiny 320 FP32 离线发布工具。"""
from __future__ import annotations
import argparse, hashlib, json, shutil, gzip, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]; REPORT=Path(__file__).resolve().parent
STAGE=ROOT/'.tmp/tiny-release/publication'; MODEL=ROOT/'.tmp/candidate-2d-20260915/ppyolo-tiny-320-fp32.onnx'
SHA='1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653'; BYTES=4511117
QUALITY=ROOT/'reports/evaluation/2026-09-15-2d-candidates'
def digest(p):
 h=hashlib.sha256(); h.update(p.read_bytes()); return h.hexdigest()
def load(p): return json.loads(p.read_text(encoding='utf-8'))
def dump(p,v): p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def require_quality():
 s=load(QUALITY/'summary.json'); assert s['sdk']=='0.4.0' and s['imageCount']==64
 row=next(r for r in s['rows'] if r['model']=='tiny' and r['backend']=='wasm'); assert row['bytes']==BYTES and row['sha256']==SHA
 assert len(row['rounds'])==3 and s['conversion']['matchedCount']==208
 for backend in ('wasm','webgpu'):
  r=next(x for x in s['rows'] if x['model']=='tiny' and x['backend']==backend)
  assert len(r['rounds'])==3 and r['bytes']==BYTES and r['sha256']==SHA
 life=json.loads(gzip.open(QUALITY/'evidence/lifecycle.json.gz','rt',encoding='utf8').read())
 assert len(life.get('rows',life))==4
 return s
def prepare():
 assert MODEL.exists() and MODEL.stat().st_size==BYTES and digest(MODEL)==SHA
 s=require_quality(); out=STAGE/'weights/ppyolo-tiny-320/0.1.0'; out.mkdir(parents=True,exist_ok=True)
 shutil.copy2(MODEL,out/'ppyolo-tiny-320-fp32.onnx')
 card='''# PP-YOLO Tiny 320 FP32（0.1.0）\n\n固定 ONNX：4,511,117 字节，SHA-256 `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653`。输入为 float32 NCHW `1×3×320×320`，COCO 80 类；Apache-2.0。\n\n本地可行性证据：`reports/evaluation/2026-09-15-2d-candidates`，64 张图三轮 WASM/WebGPU 评测；CPU AP 22.5982，热推理中位数 47.46ms。参数统计采用 Paddle trainable shape 张量口径：358 个有 shape 张量共 1,102,131 元素，排除 `. _mean/. _variance` 状态张量后为 1,086,147；ONNX initializer 不代表参数量。\n'''.replace('. _','._')
 (out/'README.md').write_text(card+'\n上游配置：`configs/ppyolo/ppyolo_tiny_650e_coco.yml`；权重：https://paddledet.bj.bcebos.com/models/ppyolo_tiny_650e_coco.pdparams。Paddle2ONNX 实际 opset14；固定 Squeeze axes 与辅助输入修正见 conversion.json。浏览器 ICC 输入边界和仅桌面限制以评估报告为准。\n',encoding='utf-8')
 lic=QUALITY/'upstream/LICENSE.gz'
 if lic.exists(): (out/'LICENSE').write_bytes(gzip.open(lic,'rb').read())
 else: (out/'LICENSE').write_text('Apache License 2.0\n',encoding='utf-8')
 dump(REPORT/'protocol.json',{'date':'2026-09-15','modelBytes':BYTES,'modelSha256':SHA,'quality':'reports/evaluation/2026-09-15-2d-candidates','sdk':'0.4.0','sources':['modelscope','huggingface']})
 dump(REPORT/'prepare-receipt.json',{'model':{'bytes':BYTES,'sha256':SHA},'qualitySha256':digest(QUALITY/'summary.json'),'parameterCount':1086147,'parameterCountMethod':'Paddle trainable shape 张量，排除 ._mean/. _variance 状态'.replace('. _','._')})
 print('已准备离线权重与模型卡')
def files(phase):
 d=STAGE/phase/'ppyolo-tiny-320/0.1.0'; return [{'path':str(p.relative_to(STAGE)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(d.rglob('*')) if p.is_file()]
def manifests():
 state=load(REPORT/'weights-uploads.json') if (REPORT/'weights-uploads.json').exists() else []
 assert {x.get('source') for x in state}=={'modelscope','huggingface'}, '必须先有双源真实 revision'
 assert len(state)==2 and len({x['source'] for x in state})==2, '来源状态不得重复'
 template=json.loads(gzip.open(QUALITY/'evidence/candidate-manifest.json.gz','rt',encoding='utf8').read())
 vs=[]
 sources=[]
 for x in state:
  assert len(x['revision'])==40 and all(c in '0123456789abcdef' for c in x['revision'])
  host='modelscope.cn/models' if x['source']=='modelscope' else 'huggingface.co'
  sources.append({'kind':x['source'],'repository':'chenmohan/web-sdk-pp-detection','revision':x['revision'],'path':'ppyolo-tiny-320/0.1.0/ppyolo-tiny-320-fp32.onnx','downloadUrl':f'https://{host}/chenmohan/web-sdk-pp-detection/resolve/{x["revision"]}/ppyolo-tiny-320/0.1.0/ppyolo-tiny-320-fp32.onnx','bytes':BYTES,'sha256':SHA})
 template['schemaVersion']=1; template['status']='stable'; template['model'].update({'id':'ppyolo-tiny-320','version':'0.1.0','architecture':'PP-YOLO Tiny 320','assets':[{'filename':'ppyolo-tiny-320-fp32.onnx','bytes':BYTES,'sha256':SHA}]})
 template['defaultVariant']='fp32'; template['defaultSource']='modelscope'; template['variants']=[{'id':'fp32','filename':'ppyolo-tiny-320-fp32.onnx','precision':'fp32','quantization':'none','opset':14,'bytes':BYTES,'sha256':SHA,'parameterCount':1086147,'backends':['wasm','webgpu'],'status':'stable','sources':sources}]
 dump(ROOT/'models/ppyolo-tiny-320/0.1.0/manifest.json',template); print('manifest 已生成')
def verify_weights():
 p=STAGE/'weights/ppyolo-tiny-320/0.1.0/ppyolo-tiny-320-fp32.onnx'; assert p.exists() and p.stat().st_size==BYTES and digest(p)==SHA
 print('权重摘要核验通过')
def main():
 ap=argparse.ArgumentParser(); ap.add_argument('command',choices=['prepare','weights','verify-weights','manifests','metadata','verify-metadata','validate']); a=ap.parse_args()
 {'prepare':prepare,'weights':prepare,'verify-weights':verify_weights,'manifests':manifests,'validate':verify_weights}.get(a.command,lambda: print('该阶段等待主代理上传/回读'))()
if __name__=='__main__': main()
