from pathlib import Path
import sys,json,hashlib,time,collections,platform
import numpy as np,onnx,onnxruntime as ort
from PIL import Image
from onnxruntime.quantization import CalibrationDataReader,CalibrationMethod,QuantFormat,QuantType,quantize_static
from onnxruntime.quantization.shape_inference import quant_pre_process
ROOT=Path(r"F:/git/00_chenmohan/github/web-sdk-PP-Detection");OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation.prepare_subset import verify_image_lock
manifest=json.loads((ROOT/'models/pp-detection/manifest.json').read_text())
source=ROOT/'models/pp-detection/picodet-l-320-fp32.onnx'
assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['variants'][0]['sha256']
cal=json.loads((OUT/'calibration/images.lock.json').read_text());verify_image_lock(OUT/'calibration/images',cal)
config=manifest['preprocessing']
def preprocess(path):
    with Image.open(path) as image:
        arr=np.asarray(image.convert('RGB').resize((320,320),Image.Resampling.BICUBIC),dtype=np.float64)
    arr=(arr*config['rescaleFactor']-np.asarray(config['mean']))/np.asarray(config['std'])
    return arr.transpose(2,0,1)[None].astype(np.float32).copy()
class Reader(CalibrationDataReader):
    def __init__(self): self.items=iter(cal);self.count=0
    def get_next(self):
        item=next(self.items,None)
        if item is None:return None
        self.count+=1
        if self.count%32==0:print('校准',self.count,flush=True)
        return {'image':preprocess(OUT/'calibration/images'/item['filename'])}
def evidence(path):
    model=onnx.load(path);onnx.checker.check_model(model,full_check=True)
    counts=collections.Counter(n.op_type for n in model.graph.node)
    dtypes=collections.Counter(onnx.TensorProto.DataType.Name(x.data_type) for x in model.graph.initializer)
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'opsets':{x.domain:x.version for x in model.opset_import},'operators':dict(counts),'initializerTypes':dict(dtypes),'fullOnnxCheck':True}
# 直接验证旧校准缺失 ImageNet 归一化；本探针使用清单中的双精度运算并输出 float32。
first=OUT/'calibration/images'/cal[0]['filename'];correct=preprocess(first)
with Image.open(first) as im:old=np.asarray(im.convert('RGB').resize((320,320)),dtype=np.float32).transpose(2,0,1)[None]/255
report={'date':'2026-09-12','status':'labs','source':evidence(source),'calibrationImages':len(cal),'calibrationDisjoint':True,'preprocessing':config,'oldCalibrationMaxAbsDifference':float(np.max(np.abs(correct-old))),'versions':{'onnx':onnx.__version__,'onnxruntime':ort.__version__,'numpy':np.__version__,'python':platform.python_version()},'candidates':{}}
(OUT/'models').mkdir(exist_ok=True)
converted=OUT/'models/fp32-opset13.onnx'
if not converted.exists():onnx.save(onnx.version_converter.convert_version(onnx.load(source),13),converted)
prepared=OUT/'models/fp32-prepared.onnx'
if not prepared.exists():quant_pre_process(converted,prepared,skip_symbolic_shape=True)
report['converted']=evidence(converted);report['prepared']=evidence(prepared)
for name,fmt,act in [('qdq-stem-fp32',QuantFormat.QDQ,QuantType.QInt8),('qoperator-stem-fp32',QuantFormat.QOperator,QuantType.QUInt8)]:
    target=OUT/'models'/f'{name}.onnx';start=time.perf_counter()
    try:
        if target.exists():raise FileExistsError(str(target))
        quantize_static(prepared,target,Reader(),quant_format=fmt,op_types_to_quantize=['Conv'],nodes_to_exclude=['Conv_0','Conv_1'],per_channel=True,activation_type=act,weight_type=QuantType.QInt8,calibrate_method=CalibrationMethod.MinMax)
        report['candidates'][name]={'status':'converted','method':fmt.name,'activation':act.name,'weight':'QInt8','perChannel':True,'quantizedOpTypes':['Conv'],'excludedNodes':['Conv_0','Conv_1'],'calibration':'MinMax','elapsedSeconds':time.perf_counter()-start,**evidence(target)}
        print(name,json.dumps(report['candidates'][name]),flush=True)
    except Exception as exc:
        report['candidates'][name]={'status':'failed','error':str(exc)}
        print(name,str(exc),flush=True)
    (OUT/'conversion-stem.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
