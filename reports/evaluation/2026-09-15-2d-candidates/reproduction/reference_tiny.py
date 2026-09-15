"""以相同输入核对 Paddle/NMS修正ONNX/单输入ONNX，另生成未处理ICC的Pillow参考。"""
import argparse
import hashlib
import json
import platform
import statistics
import sys
import time
from pathlib import Path
import cv2
import numpy as np
import onnxruntime as ort
import paddle
import paddle.inference as pdi

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / 'tools/model-pipeline'))
from evaluation import compare_detections, evaluate_coco
from ppyoloe.inference import preprocess_image, detections_to_coco

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--images', type=Path, required=True)
args = parser.parse_args()
work = args.work
annotation_path = root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
dataset = json.loads(annotation_path.read_text(encoding='utf-8'))
category_ids = sorted(item['id'] for item in dataset['categories'])
image_ids = [item['id'] for item in dataset['images']]
exported = work / 'exported/ppyolo_tiny_650e_coco'
config = pdi.Config(str(exported / 'model.pdmodel'), str(exported / 'model.pdiparams'))
config.disable_gpu()
config.set_cpu_math_library_num_threads(4)
config.disable_glog_info()
predictor = pdi.create_predictor(config)
if set(predictor.get_input_names()) != {'image', 'im_shape', 'scale_factor'}:
    raise ValueError('Paddle输入不匹配')
options = ort.SessionOptions()
options.intra_op_num_threads = 4
raw = ort.InferenceSession(str(work / 'tiny-nms-fixed.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
prepared = ort.InferenceSession(str(work / 'ppyolo-tiny-320-fp32.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
predictions = {name: [] for name in ['paddle', 'onnx-opencv', 'onnx-pillow']}
timings = []
identities = []
max_prepared_delta = 0.0


def detect(values, image):
    rows = next(value for value in values if value.ndim == 2 and value.shape[-1] == 6)
    return detections_to_coco(rows, image=image, category_ids=category_ids, input_size=320)


for image in dataset['images']:
    path = args.images / image['file_name']
    identities.append({'imageId': image['id'], 'fileName': image['file_name'],
                       'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    bgr = cv2.imread(str(path))
    if bgr is None:
        raise ValueError(f'图片读取失败：{path}')
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    tensor = cv2.resize(rgb, (320, 320), interpolation=cv2.INTER_CUBIC).astype(np.float32) / np.float32(255)
    tensor = (tensor - np.asarray([0.485, 0.456, 0.406], np.float32)) / np.asarray([0.229, 0.224, 0.225], np.float32)
    tensor = tensor.transpose(2, 0, 1)[None].copy()
    feeds = {'image': tensor, 'im_shape': np.full((1, 2), 320, np.float32), 'scale_factor': np.ones((1, 2), np.float32)}
    for name, value in feeds.items():
        predictor.get_input_handle(name).copy_from_cpu(value)
    predictor.run()
    paddle_values = [predictor.get_output_handle(name).copy_to_cpu() for name in predictor.get_output_names()]
    raw_values = raw.run(None, feeds)
    values = prepared.run(None, {'image': tensor})
    for original, candidate in zip(raw_values, values, strict=True):
        np.testing.assert_allclose(original, candidate, rtol=0, atol=0)
        max_prepared_delta = max(max_prepared_delta, float(np.max(np.abs(original - candidate), initial=0)))
    predictions['paddle'].extend(detect(paddle_values, image))
    predictions['onnx-opencv'].extend(detect(values, image))
    browser_tensor = preprocess_image(rgb, model='picodet', size=320)
    started = time.perf_counter()
    browser_values = prepared.run(None, {'image': browser_tensor})
    timings.append({'imageId': image['id'], 'inferenceMs': (time.perf_counter() - started) * 1000})
    predictions['onnx-pillow'].extend(detect(browser_values, image))

comparisons = []
for image_id in image_ids:
    row = compare_detections([x for x in predictions['paddle'] if x['image_id'] == image_id],
                             [x for x in predictions['onnx-opencv'] if x['image_id'] == image_id],
                             iou_threshold=0.99, score_threshold=0.5)
    comparisons.append({'imageId': image_id, **row})
blank = {'id': -1, 'width': 320, 'height': 320}
blank_rows = detect(prepared.run(None, {'image': preprocess_image(np.zeros((320, 320, 3), np.uint8), model='picodet', size=320)}), blank)
blank_above_threshold = sum(item['score'] >= 0.5 for item in blank_rows)
report = {'environment': {'python': platform.python_version(), 'platform': platform.platform(), 'paddle': paddle.__version__,
                          'onnxruntime': ort.__version__, 'threads': 4, 'backend': 'CPU'},
          'annotationsSha256': hashlib.sha256(annotation_path.read_bytes()).hexdigest(), 'images': identities,
          'imageCount': len(image_ids), 'nmsFixedPreparedMaximumDelta': max_prepared_delta,
          'blankDetectionsAtPoint5': blank_above_threshold,
          'modelSha256': hashlib.sha256((work / 'ppyolo-tiny-320-fp32.onnx').read_bytes()).hexdigest(),
          'paddleModelSha256': hashlib.sha256((exported / 'model.pdmodel').read_bytes()).hexdigest(),
          'paddleParametersSha256': hashlib.sha256((exported / 'model.pdiparams').read_bytes()).hexdigest(),
          'preprocessing': {'official': 'OpenCV INTER_CUBIC RGB /255 + ImageNet normalize',
                            'browserReference': 'Pillow BICUBIC RGB /255 + ImageNet normalize'},
          'evaluation': {key: evaluate_coco(dataset, values, image_ids) for key, values in predictions.items()},
          'comparison': comparisons, 'timings': timings,
          'warmInferenceMs': statistics.median(item['inferenceMs'] for item in timings[1:])}
for key, value in predictions.items():
    (work / f'{key}-predictions.json').write_text(json.dumps(value) + '\n', encoding='utf-8')
(work / 'python-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key not in ['images', 'timings', 'comparison']}, ensure_ascii=False))
