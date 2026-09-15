"""定向修正NMS单框轴，固定单图输入，生成本地labs产物；不改变权重。"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[4]
report = Path(__file__).resolve().parents[1]
work = args.work
source = work / 'tiny-raw.onnx'
raw = json.loads((report / 'raw-inspection.json').read_text(encoding='utf-8'))
if hashlib.sha256(source.read_bytes()).hexdigest() != raw['sha256']:
    raise ValueError('原始 ONNX 与固定来源不一致')
model = onnx.load(source)
if [(o.domain, o.version) for o in model.opset_import] != [('', 14)]:
    raise ValueError('本批次实际opset应为14')
nodes = {node.name: node for node in model.graph.node if node.name}
for name, input_name, consumer in [('Squeeze.7', 'Gather.5', 'Gather.12'), ('Squeeze.9', 'Gather.7', 'Gather.14')]:
    node = nodes[name]
    if node.op_type != 'Squeeze' or list(node.input) != [input_name] or node.attribute or nodes[consumer].input[0] != node.output[0]:
        raise ValueError('NMS局部结构与固定导出图不一致')
    # Gather结果为[1,N,1]；只移除外侧两轴，N=1时也保留检测列表维度。
    axes_name = name + '.fixed_axes'
    model.graph.initializer.append(numpy_helper.from_array(np.asarray([0, 2], np.int64), name=axes_name))
    node.input.append(axes_name)
onnx.checker.check_model(model)
onnx.save(model, work / 'tiny-nms-fixed.onnx')
inputs = {item.name: item for item in model.graph.input}
if set(inputs) != {'image', 'im_shape', 'scale_factor'}:
    raise ValueError('原始输入不匹配')
for name, value in [('im_shape', np.full((1, 2), 320, dtype=np.float32)),
                    ('scale_factor', np.ones((1, 2), dtype=np.float32))]:
    if inputs[name].type.tensor_type.elem_type != onnx.TensorProto.FLOAT or inputs[name].type.tensor_type.shape.dim[-1].dim_value != 2:
        raise ValueError('辅助输入形状不匹配')
    model.graph.input.remove(inputs[name])
    model.graph.initializer.append(numpy_helper.from_array(value, name=name))
shape = inputs['image'].type.tensor_type.shape.dim
if [dim.dim_value for dim in shape[1:]] != [3, 320, 320]:
    raise ValueError('图片形状不匹配')
shape[0].ClearField('dim_param')
shape[0].dim_value = 1
onnx.checker.check_model(model)
target = work / 'ppyolo-tiny-320-fp32.onnx'
onnx.save(model, target)
session = ort.InferenceSession(str(target), providers=['CPUExecutionProvider'])
outputs = [{'name': item.name, 'shape': [-1 if isinstance(d, str) else d for d in item.shape],
            'dtype': {'tensor(float)': 'float32', 'tensor(int32)': 'int32'}[item.type]} for item in session.get_outputs()]
if len(outputs) != 2 or outputs[0]['shape'][-1] != 6 or outputs[1]['shape'] != [1]:
    raise ValueError(f'输出不匹配：{outputs}')
outputs[0]['shape'] = [-1, 6]
annotations = json.loads((root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text(encoding='utf-8'))
sha = hashlib.sha256(target.read_bytes()).hexdigest()
manifest = {
    'schemaVersion': 1, 'model': {'id': 'ppyolo-tiny-320', 'version': 'b25522a0-labs.1'},
    'input': {'name': 'image', 'shape': [1, 3, 320, 320], 'dtype': 'float32'}, 'outputs': outputs,
    'preprocessing': {'size': {'width': 320, 'height': 320}, 'resizeMode': 'stretch', 'interpolation': 'bicubic',
                      'rescaleFactor': 1 / 255, 'mean': [0.485, 0.456, 0.406], 'std': [0.229, 0.224, 0.225],
                      'doResize': True, 'doRescale': True, 'doNormalize': True},
    'postprocessing': {'type': 'nms', 'scoreThreshold': 0.001, 'iouThreshold': 1,
                       'matrixCoordinates': 'pixels', 'queryCoordinates': 'pixels', 'queryBoxFormat': 'xyxy'},
    'labels': [item['name'] for item in sorted(annotations['categories'], key=lambda item: item['id'])],
    'variants': [{'id': 'ppyolo-tiny-320-fp32', 'precision': 'fp32', 'quantization': None, 'opset': 14,
                  'bytes': target.stat().st_size, 'parameterCount': None, 'status': 'labs',
                  'backends': ['wasm', 'webgpu'], 'sources': [{'kind': 'custom', 'repository': 'PaddlePaddle/PaddleDetection',
                  'revision': sha, 'path': target.name, 'downloadUrl': 'http://localhost/' + target.name,
                  'bytes': target.stat().st_size, 'sha256': sha}]}]}
result = {'sourceSha256': raw['sha256'], 'sha256': sha, 'bytes': target.stat().st_size,
          'opset': 14, 'inputs': manifest['input'], 'outputs': outputs,
          'changes': ['Squeeze.7和Squeeze.9固定axes=[0,2]，保留N=1检测轴', 'image batch=1', 'im_shape=[[320,320]]', 'scale_factor=[[1,1]]'],
          'nmsFixedSha256': hashlib.sha256((work / 'tiny-nms-fixed.onnx').read_bytes()).hexdigest(),
          'session': 'pass', 'status': 'labs'}
for location, data in [(work / 'candidate-manifest.json', manifest), (report / 'preparation.json', result)]:
    location.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
