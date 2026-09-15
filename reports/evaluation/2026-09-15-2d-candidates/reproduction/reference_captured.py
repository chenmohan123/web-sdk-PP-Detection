"""使用浏览器实际输入隔离推理后端差异，同时核对Pillow输入是否等价。"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / 'tools/model-pipeline'))
from ppyoloe.inference import detections_to_coco
from evaluation import compare_detections, evaluate_coco

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--images', type=Path, required=True)
args = parser.parse_args()
work = args.work
captured = json.loads((work / 'captured-inputs.json').read_text(encoding='utf-8'))
dataset = json.loads((root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text(encoding='utf-8'))
category_ids = sorted(item['id'] for item in dataset['categories'])
image_ids = [item['id'] for item in dataset['images']]
session = ort.InferenceSession(str(work / 'ppyolo-tiny-320-fp32.onnx'), providers=['CPUExecutionProvider'])
predictions, inputs = [], []
for image in dataset['images']:
    content = (work / f'inputs/{image["id"]}.f32').read_bytes()
    item = next(row for row in captured['inputs'] if row['imageId'] == image['id'])
    if hashlib.sha256(content).hexdigest() != item['sha256'] or len(content) != item['bytes']:
        raise ValueError('实际输入摘要不一致')
    tensor = np.frombuffer(content, dtype='<f4').reshape(1, 3, 320, 320)
    values = session.run(None, {'image': tensor})
    predictions.extend(detections_to_coco(values[0], image=image, category_ids=category_ids, input_size=320))
    with Image.open(args.images / image['file_name']) as source:
        icc_bytes = len(source.info.get('icc_profile', b''))
        resized = np.asarray(source.convert('RGB').resize((320, 320), Image.Resampling.BICUBIC), dtype=np.float64)
    pillow = ((resized * (1 / 255) - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])).astype(np.float32)
    pillow = pillow.transpose(2, 0, 1)[None].copy()
    delta = np.abs(pillow - tensor)
    inputs.append({'imageId': image['id'], 'iccProfileBytes': icc_bytes, 'maxDelta': float(delta.max()), 'differentElements': int(np.count_nonzero(delta > 1e-6))})
browser = json.loads((work / 'round-1/tiny-wasm.json').read_text(encoding='utf-8'))
comparison = [compare_detections([x for x in predictions if x['image_id'] == image_id],
                                [x for x in browser['predictions'] if x['image_id'] == image_id],
                                iou_threshold=0.99, score_threshold=0.5) for image_id in image_ids]
summary = {key: sum(item[key] for item in comparison) for key in ['referenceCount', 'candidateCount', 'matchedCount', 'unmatchedReferenceCount', 'unmatchedCandidateCount']}
summary.update({key: max(item[key] or 0 for item in comparison) for key in ['maxScoreDelta', 'maxBboxDeltaPixels']})
result = {'capturedInputsSha256': hashlib.sha256((work / 'captured-inputs.json').read_bytes()).hexdigest(),
          'modelSha256': captured['modelSha256'], 'onnxruntime': ort.__version__, 'imageCount': len(image_ids),
          'evaluation': evaluate_coco(dataset, predictions, image_ids), 'comparison': summary,
          'pillowInputDifference': inputs, 'inputShapes': captured['shape']}
(work / 'captured-reference.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(work / 'captured-predictions.json').write_text(json.dumps(predictions) + '\n', encoding='utf-8')
print(json.dumps({'AP': result['evaluation']['metrics']['AP'] * 100, 'comparison': summary,
                  'differentInputImages': sum(item['differentElements'] > 0 for item in inputs),
                  'maxInputDifference': max(item['maxDelta'] for item in inputs)}))
