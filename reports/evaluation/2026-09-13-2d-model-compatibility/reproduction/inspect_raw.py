"""检查原始 ONNX 并记录 ONNX Runtime 会话创建失败或成功，不掩盖导出缺陷。"""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform
import onnx
import onnxruntime as ort

root = Path(__file__).resolve().parents[4]
work = root / '.tmp/sod-20260913'
path = work / 'ppyoloe-sod-l-640-raw.onnx'
model = onnx.load(path)
def tensor(value):
    return {'name': value.name, 'dtype': onnx.TensorProto.DataType.Name(value.type.tensor_type.elem_type), 'shape': [d.dim_param or d.dim_value for d in value.type.tensor_type.shape.dim]}
result = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'opsets': [{'domain': v.domain, 'version': v.version} for v in model.opset_import], 'inputs': [tensor(v) for v in model.graph.input], 'outputs': [tensor(v) for v in model.graph.output], 'environment': {'python': platform.python_version(), 'platform': platform.platform(), **{k:version(k) for k in ['paddlepaddle','paddle2onnx','onnx','onnxruntime']}}}
try:
    onnx.checker.check_model(model)
    result['onnxCheck'] = 'pass'
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
    result['ortSession'] = 'pass'
except Exception as error:
    result['failure'] = {'type': type(error).__name__, 'message': str(error)}
(work / 'raw-inspection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(result.get('failure', {'ortSession': result.get('ortSession')}), ensure_ascii=False))
