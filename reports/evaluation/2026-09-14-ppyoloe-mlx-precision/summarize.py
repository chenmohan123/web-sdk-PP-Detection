"""从经过摘要校验的原始证据重算 COCO 质量、两种逐框口径和耗时。"""
from __future__ import annotations

import argparse
import contextlib
import gzip
import hashlib
import io
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
sys.path.insert(0, str(ROOT / 'tools/model-pipeline'))
from evaluation import compare_detections, evaluate_coco
from evaluate import verify_python


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def parity(reference, candidate, image_ids, iou):
    grouped = []
    for predictions in (reference, candidate):
        images = defaultdict(list)
        for item in predictions:
            images[item['image_id']].append(item)
        grouped.append(images)
    results = [compare_detections(grouped[0][image_id], grouped[1][image_id], iou_threshold=iou, score_threshold=0.5)
               for image_id in image_ids]
    counts = {name: sum(result[name] for result in results)
              for name in ('referenceCount', 'candidateCount', 'matchedCount', 'unmatchedReferenceCount', 'unmatchedCandidateCount')}
    counts['matchedReferenceFraction'] = counts['matchedCount'] / counts['referenceCount'] if counts['referenceCount'] else None
    for name in ('maxScoreDelta', 'maxBboxDeltaPixels'):
        counts[name] = max((result[name] for result in results if result[name] is not None), default=None)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-dir', type=Path, help='归档前显式读取本轮工作目录；默认校验并读取 gzip 归档')
    args = parser.parse_args()
    archived = {}
    if args.raw_dir is None:
        for entry in read(REPORT / 'artifact-index.json'):
            compressed = (REPORT / entry['path']).read_bytes()
            assert hashlib.sha256(compressed).hexdigest() == entry['compressedSha256']
            raw = gzip.decompress(compressed)
            assert len(raw) == entry['bytes'] and hashlib.sha256(raw).hexdigest() == entry['sha256']
            archived[Path(entry['path']).name.removesuffix('.gz')] = raw

    def raw_bytes(name):
        return (args.raw_dir / name).read_bytes() if args.raw_dir else archived[name]

    def raw(name):
        return json.loads(raw_bytes(name))

    dataset_path = ROOT / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
    dataset = read(dataset_path)
    image_ids = [image['id'] for image in dataset['images']]
    assert len(image_ids) == len(set(image_ids)) == 64
    summary = {'dataset': {'imageCount': len(image_ids), 'groundTruthCount': len(dataset['annotations']),
                           'annotationsSha256': hashlib.sha256(dataset_path.read_bytes()).hexdigest()},
               'criteria': {'scoreThreshold': 0.5, 'strictIou': 0.99, 'referenceRetention': 0.95,
                            'maximumApDropPoints': 0.5, 'diagnosticIou': 0.5},
               'models': {}}
    jobs = read(REPORT / 'jobs.json')
    browser_identity = None
    python_versions = None
    image_lock = read(ROOT / 'reports/evaluation/2026-09-11-ppyoloe/dataset/images.lock.json')
    image_hashes = {item['filename']: item['sha256'] for item in image_lock}
    assert set(image_hashes) == {image['file_name'] for image in dataset['images']}
    browser_images = '\n'.join(f'{image["file_name"]}:{image_hashes[image["file_name"]]}' for image in dataset['images'])
    browser_image_sha256 = hashlib.sha256(browser_images.encode()).hexdigest()
    summary['dataset']['browserImageSetSha256'] = browser_image_sha256
    locked_images = '\n'.join(f'{item["filename"]}:{item["sha256"]}' for item in image_lock)
    input_identity = {'annotationsSha256': summary['dataset']['annotationsSha256'],
                      'imageSetSha256': hashlib.sha256(locked_images.encode()).hexdigest(),
                      'inferenceScriptSha256': hashlib.sha256((ROOT / 'tools/model-pipeline/ppyoloe/inference.py').read_bytes()).hexdigest(),
                      'preprocessing': 'OpenCV INTER_CUBIC RGB /255', 'threads': 4}
    for size in ('m', 'l', 'x'):
        variants = {}
        references = {}
        for precision in ('fp32', 'fp16', 'w8a32'):
            job = next(job for job in jobs if job['size'] == size and job['precision'] == precision)
            row = {'bytes': job['bytes'], 'sha256': job['sha256'], 'backends': {}}
            base_bytes = next(job['bytes'] for job in jobs if job['size'] == size and job['precision'] == 'fp32')
            row['reductionPercent'] = (1 - job['bytes'] / base_bytes) * 100
            for backend in ('python', 'wasm', 'webgpu'):
                report = raw(f'{size}-{precision}-{backend}.json')
                predictions = raw(f'{size}-{precision}-python-predictions.json') if backend == 'python' else report['predictions']
                if backend == 'python':
                    stem = f'{size}-{precision}-python'
                    binding = raw(f'{stem}-binding.json')
                    versions = binding['identity']['runtimeVersions']
                    if python_versions is None:
                        python_versions = versions
                        summary['pythonRuntimeVersions'] = versions
                    assert versions == python_versions, 'Python 比较必须使用相同运行环境版本'
                    assert report['environment'] == {
                        **{key: versions[key] for key in ('python', 'platform', 'onnxruntime')},
                        'backend': 'CPUExecutionProvider', 'intraOpThreads': 4}
                    assert report['preprocessing'] == input_identity['preprocessing']
                    assert report['modelBytes'] == job['bytes']
                    verify_python(binding, {**input_identity, 'modelSha256': job['sha256'], 'runtimeVersions': versions},
                                  raw_bytes(f'{stem}.json'), raw_bytes(f'{stem}-predictions.json'))
                    assert report['modelSha256'] == job['sha256']
                    timings = {'sessionMs': report['sessionMs'], 'firstInferenceMs': report['images'][0]['inferenceMs'],
                               'warmInferenceMedianMs': statistics.median(image['inferenceMs'] for image in report['images'][1:])}
                else:
                    assert report['status'] == 'passed'
                    expected_precision = 'int8' if precision == 'w8a32' else precision
                    assert report['evaluation'] == {
                        'allowExperimental': True, 'allowFallback': False, 'executionMode': 'main',
                        'expectedImages': 64, 'manifestOverrides': {'iouThreshold': 1, 'scoreThreshold': 0.001},
                        'numThreads': 1, 'preprocessing': {'interpolation': 'bicubic', 'reference': 'Pillow bicubic'},
                        'requestedBackend': backend, 'precision': expected_precision, 'scoreThreshold': 0.001}
                    assert report['model']['bytes'] == job['bytes']
                    assert report['runtime']['backend'] == backend and not report['runtime']['fallbacks']
                    assert report['runtime']['mode'] == 'main'
                    assert report['runtime']['requestedBackend'] == backend
                    assert report['artifacts']['imageSetSha256'] == browser_image_sha256
                    assert report['model']['precision'] == ('int8' if precision == 'w8a32' else precision)
                    assert report['artifacts']['model']['sha256'] == job['sha256']
                    assert report['artifacts']['annotations']['sha256'] == summary['dataset']['annotationsSha256']
                    assert report['artifacts']['manifest']['sha256'] == hashlib.sha256((ROOT / job['manifest']).read_bytes()).hexdigest()
                    identity = (report['artifacts']['sdk']['sha256'], report['artifacts']['imageSetSha256'],
                                report['runtimeVersions']['sdk'], report['runtimeVersions']['onnxruntimeWeb'],
                                report['environment']['browser']['version'])
                    if browser_identity is None:
                        browser_identity = identity
                    assert identity == browser_identity, '浏览器比较必须使用同一 SDK、图片字节和运行时版本'
                    if backend == 'webgpu':
                        assert report['environment']['gpu']['physical']
                    timings = {**report['performance'],
                               'warmInferenceMedianMs': statistics.median(image['timings']['inferenceMs'] for image in report['images'][1:])}
                assert [image['imageId'] for image in report['images']] == image_ids
                assert all(item['image_id'] in image_ids for item in predictions)
                with contextlib.redirect_stdout(io.StringIO()):
                    metrics = evaluate_coco(dataset, predictions, image_ids)['metrics']
                if precision == 'fp32':
                    references[backend] = (metrics, predictions)
                baseline_metrics, baseline_predictions = references[backend]
                strict = parity(baseline_predictions, predictions, image_ids, 0.99)
                diagnostic = parity(baseline_predictions, predictions, image_ids, 0.5)
                assert strict['matchedCount'] <= diagnostic['matchedCount']
                ap_delta = (metrics['AP'] - baseline_metrics['AP']) * 100
                passes = ap_delta >= -0.5 and strict['matchedReferenceFraction'] is not None and strict['matchedReferenceFraction'] >= 0.95
                row['backends'][backend] = {'metrics': metrics, 'apDeltaPoints': ap_delta, 'strictParity': strict,
                                            'diagnosticParity': diagnostic, 'qualityGatePassed': passes,
                                            'performance': timings, 'environment': report['environment']}
            row['qualityGatePassed'] = all(item['qualityGatePassed'] for item in row['backends'].values())
            row['decision'] = 'baseline' if precision == 'fp32' else ('candidate-needs-repeat-and-lifecycle' if row['qualityGatePassed'] else 'labs')
            variants[precision] = row
            print(f'{size}/{precision}: {row["decision"]}', flush=True)
        summary['models'][size] = variants
    (REPORT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
