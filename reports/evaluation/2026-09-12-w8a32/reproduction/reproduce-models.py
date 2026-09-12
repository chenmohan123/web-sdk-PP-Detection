from pathlib import Path
import json,sys,hashlib,copy
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from weight_only import convert
# 用法：python reproduce-models.py <新产物目录>；在 SDK 根目录执行。
destination=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'.tmp/w8a32-reproduction'
if destination.exists():raise FileExistsError(destination)
recipes=[('picodet','pp-detection',ROOT/'models/pp-detection/picodet-l-320-fp32.onnx','1.0.2-w8a32.labs.1',['Conv_0','Conv_1']),('ppyoloe','ppyoloe-plus-s-640',ROOT/'.tmp/phase2/ppyoloe-plus-s-candidate.onnx','0.1.1-w8a32.labs.1',[])]
for name,modelpath,source,version,exclude in recipes:
 m=json.loads((ROOT/'models'/modelpath/'manifest.json').read_text(encoding='utf8'));original=m['variants'][0];directory=destination/name;directory.mkdir(parents=True);target=directory/f'{name}-w8a32.onnx'
 report=convert(source,target,expected_sha256=original['sha256'],exclude_nodes=exclude)
 b=report['output'];sha=b['sha256'];v=copy.deepcopy(original)
 v.update({'id':'w8a32','filename':target.name,'precision':'int8','quantization':'weight-only-int8-activation-fp32','opset':13,'bytes':b['bytes'],'sha256':sha,'status':'labs','sources':[{'kind':'custom','repository':'local://detection-w8a32','revision':sha,'path':target.name,'downloadUrl':'http://localhost/model/model.onnx','bytes':b['bytes'],'sha256':sha}]})
 m['status']='labs';m['model']['version']=version;m['defaultVariant']='w8a32';m['defaultSource']='custom';m['variants']=[v];m['limitations']=['权重 INT8 存储，激活和卷积计算 FP32。','仅本地实验产物；按日期证据声明兼容性。','尚未完成移动端、峰值内存和独立大规模验证。']
 for filename,value in [('manifest.json',m),('conversion.json',report)]:
  (directory/filename).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print(name,json.dumps(b),flush=True)
