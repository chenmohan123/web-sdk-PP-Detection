"""核对原始图元数据，并用固定首图复现未修正 NMS 的单框错误。"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
import onnx
import onnxruntime as ort

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--images', type=Path, required=True)
args = parser.parse_args()
report = Path(__file__).resolve().parents[1]
root = Path(__file__).resolve().parents[4]
source = args.work / 'tiny-raw.onnx'
model = onnx.load(source)
onnx.checker.check_model(model)
options = ort.SessionOptions()
options.log_severity_level = 4
session = ort.InferenceSession(str(source), sess_options=options, providers=['CPUExecutionProvider'])
inspection = {
    'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'bytes': source.stat().st_size,
    'opset': [[item.domain, item.version] for item in model.opset_import],
    'inputs': [str(item) for item in model.graph.input],
    'outputs': [str(item) for item in model.graph.output],
    'operators': dict(Counter(item.op_type for item in model.graph.node)),
    'session': 'pass',
}
if inspection != json.loads((report / 'raw-inspection.json').read_text(encoding='utf-8')):
    raise ValueError('原始图与归档元数据不一致')
dataset = json.loads((root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text(encoding='utf-8'))
image = dataset['images'][0]
if image['id'] != 270244:
    raise ValueError('首图身份不一致')
bgr = cv2.imread(str(args.images / image['file_name']))
if bgr is None:
    raise ValueError('首图读取失败')
tensor = cv2.resize(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), (320, 320), interpolation=cv2.INTER_CUBIC).astype(np.float32) / np.float32(255)
tensor = (tensor - np.asarray([0.485, 0.456, 0.406], np.float32)) / np.asarray([0.229, 0.224, 0.225], np.float32)
feeds = {'image': tensor.transpose(2, 0, 1)[None].copy(),
         'im_shape': np.full((1, 2), 320, np.float32), 'scale_factor': np.ones((1, 2), np.float32)}
try:
    session.run(None, feeds)
except ort.capi.onnxruntime_pybind11_state.RuntimeException as error:
    if 'Gather.12' not in str(error) or 'axis 0 is not in valid range' not in str(error):
        raise
    result = {'metadata': 'pass', 'imageId': image['id'], 'expectedFailureReproduced': True, 'error': str(error)}
else:
    raise AssertionError('原图未触发预期错误，需重新检查环境和输入')
(args.work / 'raw-diagnostic.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
