"""归档并复算本批次真实证据；默认从压缩证据复核，无需模型或浏览器。"""
import argparse
import gzip
import hashlib
import json
import statistics
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[4]
report = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'tools/model-pipeline'))
from evaluation import compare_detections, evaluate_coco

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path)
args = parser.parse_args()
sha = lambda value: hashlib.sha256(value).hexdigest()
annotation_path = root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
dataset = json.loads(annotation_path.read_text(encoding='utf-8'))
image_ids = [image['id'] for image in dataset['images']]
annotation_sha = sha(annotation_path.read_bytes())
sdk_sha = 'c2b6a9733416571c77c8dc48fa68028251e5d8cccb201047c8387bf9433e1189'
image_set_sha = '1a36e342e8b8f00a4709d60f9f90d783ec61b179f89d64f041192d350281a99c'
files = ['python-reference.json', 'paddle-predictions.json', 'onnx-opencv-predictions.json', 'onnx-pillow-predictions.json',
         'candidate-manifest.json', 'lifecycle.json', 'export.log', 'reference-raw-failure.log',
         'captured-inputs.json', 'captured-reference.json', 'captured-predictions.json']
files += [f'round-{round}/{model}-{backend}.json' for round in [1, 2, 3] for model in ['tiny', 'picodet-xs', 'picodet-s'] for backend in ['wasm', 'webgpu']]
if args.archive:
    index = []
    for relative in files:
        source = args.archive / relative
        target = report / 'evidence' / (relative + '.gz')
        target.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_bytes()
        compressed = gzip.compress(content, mtime=0)
        target.write_bytes(compressed)
        index.append({'path': target.relative_to(report).as_posix(), 'bytes': len(compressed), 'sha256': sha(compressed),
                      'uncompressedBytes': len(content), 'uncompressedSha256': sha(content)})
    (report / 'evidence-index.json').write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')
index = json.loads((report / 'evidence-index.json').read_text(encoding='utf-8'))
loaded = {}
for entry in index:
    compressed = (report / entry['path']).read_bytes()
    if sha(compressed) != entry['sha256'] or len(compressed) != entry['bytes']:
        raise ValueError('压缩证据摘要不一致')
    content = gzip.decompress(compressed)
    if sha(content) != entry['uncompressedSha256'] or len(content) != entry['uncompressedBytes']:
        raise ValueError('原始证据摘要不一致')
    loaded[entry['path'].removeprefix('evidence/').removesuffix('.gz')] = content
if set(loaded) != set(files):
    raise ValueError('证据集合不完整或重复')
read = lambda relative: json.loads(loaded[relative])
manifest = read('candidate-manifest.json')
prep = json.loads((report / 'preparation.json').read_text(encoding='utf-8'))
if manifest['variants'][0]['sources'][0]['sha256'] != prep['sha256']:
    raise ValueError('候选清单与准备记录不一致')
identities = {'tiny': {'sha256': prep['sha256'], 'bytes': prep['bytes']}}
for name in ['xs', 's']:
    current = json.loads((root / f'models/pp-detection/picodet-{name}-320/1.0.1/manifest.json').read_text(encoding='utf-8'))
    identities['picodet-' + name] = current['model']['assets'][0]


def compare(reference, candidate):
    details = [compare_detections([x for x in reference if x['image_id'] == image_id],
                                 [x for x in candidate if x['image_id'] == image_id],
                                 iou_threshold=0.99, score_threshold=0.5) for image_id in image_ids]
    totals = {key: sum(item[key] for item in details) for key in ['referenceCount', 'candidateCount', 'matchedCount', 'unmatchedReferenceCount', 'unmatchedCandidateCount']}
    totals.update({key: max((item[key] or 0) for item in details) for key in ['maxScoreDelta', 'maxBboxDeltaPixels']})
    return totals


python_reference = read('python-reference.json')
if python_reference['modelSha256'] != prep['sha256'] or python_reference['annotationsSha256'] != annotation_sha:
    raise ValueError('Python参考身份不一致')
python_reference_predictions = read('onnx-pillow-predictions.json')
captured_reference = read('captured-reference.json')
captured_inputs = read('captured-inputs.json')
captured_predictions = read('captured-predictions.json')
if captured_reference['capturedInputsSha256'] != sha(loaded['captured-inputs.json']) or captured_reference['modelSha256'] != prep['sha256']:
    raise ValueError('实际输入参考身份不一致')
if captured_inputs['sdkSha256'] != sdk_sha or not captured_inputs['referencePredictionsUnchanged'] or len(captured_inputs['inputs']) != 64:
    raise ValueError('实际输入捕获身份不一致')
conversion = compare(read('paddle-predictions.json'), read('onnx-opencv-predictions.json'))
if conversion['unmatchedReferenceCount'] or conversion['unmatchedCandidateCount']:
    raise ValueError('Paddle与ONNX转换核验失败')
rows = []
for model in ['tiny', 'picodet-xs', 'picodet-s']:
    for backend in ['wasm', 'webgpu']:
        rounds = []
        for round in [1, 2, 3]:
            data = read(f'round-{round}/{model}-{backend}.json')
            if data['status'] != 'passed' or data['runtime']['backend'] != backend or data['runtime']['fallbacks']:
                raise ValueError('后端或回退状态不一致')
            if data['runtime']['mode'] != 'main' or data['runtimeVersions'] != {'onnxruntimeWeb': '1.27.0', 'sdk': '0.4.0'}:
                raise ValueError('运行环境版本不一致')
            artifacts = data['artifacts']
            if artifacts['sdk']['sha256'] != sdk_sha or artifacts['annotations']['sha256'] != annotation_sha or artifacts['imageSetSha256'] != image_set_sha:
                raise ValueError('SDK或数据集不一致')
            if artifacts['model']['sha256'] != identities[model]['sha256'] or artifacts['model']['bytes'] != identities[model]['bytes']:
                raise ValueError('模型身份不一致')
            if [image['imageId'] for image in data['images']] != image_ids or len(set(image_ids)) != 64:
                raise ValueError('缺图、重复图片或顺序错误')
            if backend == 'webgpu' and not data['environment']['gpu']['physical']:
                raise ValueError('GPU不是已验证物理适配器')
            evaluation = evaluate_coco(dataset, data['predictions'], image_ids)
            current = {'round': round, 'AP': evaluation['metrics']['AP'] * 100,
                       'warmInferenceMs': statistics.median(image['timings']['inferenceMs'] for image in data['images'][1:]),
                       'warmTotalMs': statistics.median(image['wallClockMs'] for image in data['images'][1:]),
                       'sessionMs': data['loadTimings']['sessionMs']}
            if model == 'tiny':
                current['pythonComparison'] = compare(captured_predictions, data['predictions'])
                current['unmanagedPillowComparison'] = compare(python_reference_predictions, data['predictions'])
                if current['pythonComparison']['unmatchedReferenceCount'] or current['pythonComparison']['unmatchedCandidateCount']:
                    raise ValueError('浏览器与相同实际输入的Python参考不一致')
            rounds.append(current)
        rows.append({'model': model, 'backend': backend, 'bytes': identities[model]['bytes'], 'sha256': identities[model]['sha256'],
                     'apRange': [min(row['AP'] for row in rounds), max(row['AP'] for row in rounds)],
                     'warmInferenceMs': statistics.median(row['warmInferenceMs'] for row in rounds), 'rounds': rounds})
lifecycle = read('lifecycle.json')
if lifecycle['modelSha256'] != prep['sha256'] or lifecycle['sdkSha256'] != sdk_sha:
    raise ValueError('生命周期证据身份不一致')
if {(row['backend'], row['executionMode']) for row in lifecycle['rows']} != {(b, m) for b in ['wasm', 'webgpu'] for m in ['main', 'worker']}:
    raise ValueError('生命周期组合不完整')
for row in lifecycle['rows']:
    if row['status'] != 'passed' or row['abortCode'] != 'ABORTED' or row['disposedCode'] != 'DISPOSED':
        raise ValueError('生命周期失败')
summary = {'date': '2026-09-15', 'sdk': '0.4.0', 'sdkSha256': sdk_sha, 'annotationsSha256': annotation_sha,
           'imageSetSha256': image_set_sha, 'imageCount': 64, 'annotationCount': 716,
           'environment': read('round-1/tiny-webgpu.json')['environment'],
           'conversion': conversion, 'nmsFixedPreparedMaximumDelta': python_reference['nmsFixedPreparedMaximumDelta'],
           'blankDetectionsAtPoint5': python_reference['blankDetectionsAtPoint5'],
           'preprocessAP': {key: value['metrics']['AP'] * 100 for key, value in python_reference['evaluation'].items()},
           'capturedInputAP': captured_reference['evaluation']['metrics']['AP'] * 100,
           'inputBoundary': {'identicalPillowImages': sum(item['differentElements'] == 0 for item in captured_reference['pillowInputDifference']),
                             'differentPillowImages': sum(item['differentElements'] > 0 for item in captured_reference['pillowInputDifference']),
                             'allDifferentImagesHaveICC': all(item['iccProfileBytes'] > 0 for item in captured_reference['pillowInputDifference'] if item['differentElements'] > 0),
                             'note': 'Pillow未做ICC色彩管理；以浏览器实际float32输入的Python输出判断推理后端一致性'},
           'rows': rows, 'lifecycleCombinations': len(lifecycle['rows']),
           'timingMethod': '每轮去除首图，取63图inference中位数，再取三轮中位数；不含下载、初始化和预处理',
           'scope': '桌面可行性评测；不自动提升为稳定模型或新增分发来源'}
output = json.dumps(summary, ensure_ascii=False, indent=2) + '\n'
if args.archive:
    (report / 'summary.json').write_text(output, encoding='utf-8')
elif (report / 'summary.json').read_text(encoding='utf-8') != output:
    raise ValueError('归档复算与汇总不一致')
print(json.dumps({'rows': [{k: value for k, value in row.items() if k != 'rounds'} for row in rows], 'conversion': conversion,
                  'lifecycleCombinations': len(lifecycle['rows']), 'verification': 'pass'}, ensure_ascii=False))
