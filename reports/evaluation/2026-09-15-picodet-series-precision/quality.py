"""严格复算三轮 PicoDet 质量；同时供浏览器驱动校验和归档使用。"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
WORK = ROOT / '.tmp/picodet-series-precision'
sys.path.insert(0, str(ROOT / 'tools/model-pipeline'))
from evaluation import compare_detections, evaluate_coco

MODEL_KEYS = [f'picodet-{size}-{dim}' for size in ('xs', 's', 'm') for dim in (320, 416)] + ['picodet-l-416', 'picodet-l-640']
PRECISIONS = ['fp32', 'fp16', 'w8a32']
BACKENDS = ['wasm', 'webgpu']
ANNOTATIONS = ROOT / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
ANNOTATIONS_SHA = 'd398fc9b09d97135e9b92d28d170681ed50bcd3a5518f16f559e6e379adc1b79'

def require(value, message):
    if not value:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read(path):
    return json.loads(Path(path).read_bytes())

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8', newline='\n')

def precision(value):
    return 'int8' if value == 'w8a32' else value

def stem(job, backend):
    return f'{job["key"]}-{job["precision"]}-{backend}'

def validate_protocol_jobs(protocol, jobs):
    require(protocol['rounds'] == [1, 2, 3] and protocol['backends'] == BACKENDS, '轮次或后端轴错误')
    require(protocol['models'] == MODEL_KEYS and protocol['precisions'] == PRECISIONS, '模型或精度轴错误')
    require(protocol['qualityGate'] == {'maximumApDropPoints': .5, 'minimumReferenceRetention': .95, 'scoreThreshold': .5, 'iouThreshold': .5, 'strictIouDiagnostic': .99}, '质量门槛错误')
    require(protocol['dataset'] == {'images': 64, 'annotations': 716, 'annotationsSha256': ANNOTATIONS_SHA}, '数据集协议错误')
    expected = {(key, p) for key in MODEL_KEYS for p in PRECISIONS}
    require(len(jobs) == 24 and {(j['key'], j['precision']) for j in jobs} == expected, 'jobs 缺失或重复')
    for job in jobs:
        require(job['inputSize'] == int(job['key'].split('-')[-1]), '输入尺寸错误')
        require(isinstance(job['bytes'], int) and job['bytes'] > 0 and len(job['sha256']) == 64, '模型身份错误')

def environment(value):
    env = value['environment']
    return {'cpu': env['cpu'], 'os': env['os'], 'browser': {k: v for k, v in env['browser'].items()}, 'runtimeVersions': value['runtimeVersions']}

def make_lock(image_root):
    protocol = read(REPORT / 'protocol.json')
    jobs = read(REPORT / 'jobs.json')
    validate_protocol_jobs(protocol, jobs)
    ann = read(ANNOTATIONS)
    require(sha(ANNOTATIONS.read_bytes()) == ANNOTATIONS_SHA, '标注 SHA 错误')
    require(len(ann['images']) == 64 and len(ann['annotations']) == 716, '数据集不完整')
    images = [{'fileName': x['file_name'], 'imageId': x['id'], 'sha256': sha((image_root / x['file_name']).read_bytes())} for x in ann['images']]
    artifacts = {}
    for job in jobs:
        model = (ROOT / job['model']).read_bytes()
        require(len(model) == job['bytes'] and sha(model) == job['sha256'], f'{job["key"]} 模型内容变化')
        manifest = read(ROOT / job['manifest'])
        variant = next((x for x in manifest['variants'] if x['id'] == job['precision']), None)
        require(variant is not None and variant['precision'] == precision(job['precision']), '清单精度错误')
        require(variant['bytes'] == job['bytes'] and variant['sha256'] == job['sha256'], '清单模型身份错误')
        artifacts[f'{job["key"]}-{job["precision"]}'] = {'manifestSha256': sha((ROOT / job['manifest']).read_bytes()), 'modelId': manifest['model']['id'], 'modelVersion': manifest['model']['version']}
    # 使用本轮真实 FP32 记录固定环境；每条复用记录仍独立校验全部身份。
    reference = read(WORK / 'round-1/picodet-xs-320-fp32-webgpu.json')
    require(reference['status'] == 'passed', '环境参考未通过')
    return {'protocolSha256': sha((REPORT / 'protocol.json').read_bytes()), 'jobsSha256': sha((REPORT / 'jobs.json').read_bytes()), 'annotationsSha256': ANNOTATIONS_SHA,
            'sdkSha256': sha((ROOT / 'packages/sdk/dist/browser-global.js').read_bytes()), 'images': images,
            'imageSetSha256': sha('\n'.join(f'{x["fileName"]}:{x["sha256"]}' for x in images).encode()),
            'models': artifacts, 'environment': environment(reference), 'gpuAdapter': reference['environment']['gpu']['adapter']}

def validate_record(value, binding, raw, job, backend, round_no, lock):
    label = f'{round_no}/{stem(job, backend)}'
    require(binding == {'round': round_no, 'protocolSha256': lock['protocolSha256'], 'resultSha256': sha(raw)}, f'{label} 绑定错误')
    require(value['status'] == 'passed', f'{label} 未运行通过')
    require(value['schemaVersion'] == 1, '证据版本错误')
    require(environment(value) == lock['environment'], f'{label} 环境或运行时版本改变')
    runtime = value['runtime']
    require(runtime['requestedBackend'] == backend and runtime['backend'] == backend and runtime['mode'] == 'main' and runtime['fallbacks'] == [], f'{label} 后端回退或模式错误')
    require(runtime['precision'] == precision(job['precision']), '运行精度错误')
    model = value['model']
    identity = lock['models'][f'{job["key"]}-{job["precision"]}']
    require(model['id'] == identity['modelId'] and model['version'] == identity['modelVersion'] and model['variantId'] == job['precision'] and model['precision'] == precision(job['precision']) and model['bytes'] == job['bytes'], f'{label} 模型选择错误')
    expected_evaluation = {'allowExperimental': True, 'allowFallback': False, 'executionMode': 'main', 'expectedImages': 64, 'manifestOverrides': {'iouThreshold': 1, 'scoreThreshold': .001}, 'numThreads': 1,
        'preprocessing': {'interpolation': 'bicubic', 'reference': 'Pillow bicubic'}, 'requestedBackend': backend, 'precision': precision(job['precision']), 'scoreThreshold': .001}
    require(value['evaluation'] == expected_evaluation, f'{label} 评测参数改变')
    artifacts = value['artifacts']
    for name, expected in [('model', job['sha256']), ('manifest', identity['manifestSha256']), ('sdk', lock['sdkSha256']), ('annotations', ANNOTATIONS_SHA)]:
        require(artifacts[name]['sha256'] == expected, f'{label} {name} 摘要错误')
    require(artifacts['model']['bytes'] == job['bytes'] and artifacts['imageCount'] == 64 and artifacts['imageSetSha256'] == lock['imageSetSha256'], f'{label} 图集或模型字节数错误')
    require(len(value['images']) == 64, f'{label} 缺图')
    require([x['imageId'] for x in value['images']] == [x['imageId'] for x in lock['images']], f'{label} 图片顺序或ID错误')
    for actual, expected in zip(value['images'], lock['images']):
        require(actual['fileName'] == expected['fileName'] and actual['sha256'] == expected['sha256'], f'{label} 图片内容错误')
        require(math.isfinite(actual['wallClockMs']) and actual['wallClockMs'] >= 0, '图片耗时无效')
    if backend == 'webgpu':
        gpu = value['environment']['gpu']
        require(gpu['physical'] is True and gpu['adapter']['isFallbackAdapter'] is False and gpu['adapter'] == lock['gpuAdapter'], f'{label} 非固定物理GPU')
    require(isinstance(value['predictions'], list), '缺少原始预测')
    timestamp = datetime.fromisoformat(value['capturedAt'].replace('Z', '+00:00'))
    return timestamp

def parity(reference, candidate, ids, threshold):
    left, right = defaultdict(list), defaultdict(list)
    for x in reference:
        if x['score'] >= .5: left[x['image_id']].append(x)
    for x in candidate:
        if x['score'] >= .5: right[x['image_id']].append(x)
    results = [compare_detections(left[i], right[i], iou_threshold=threshold, score_threshold=.5) for i in ids]
    count = sum(x['referenceCount'] for x in results)
    matched = sum(x['matchedCount'] for x in results)
    return {'referenceCount': count, 'matchedCount': matched, 'fraction': matched / count if count else 1.0}

def quality_pass(ap_delta, retention):
    return math.isfinite(ap_delta) and ap_delta >= -.5 and retention >= .95

def summarize(archive=False):
    protocol, jobs, lock = (read(REPORT / x) for x in ('protocol.json', 'jobs.json', 'inputs.lock.json'))
    validate_protocol_jobs(protocol, jobs)
    require(lock['protocolSha256'] == sha((REPORT / 'protocol.json').read_bytes()) and lock['jobsSha256'] == sha((REPORT / 'jobs.json').read_bytes()), '锁定输入改变')
    require(sha(ANNOTATIONS.read_bytes()) == ANNOTATIONS_SHA, '标注发生变化')
    for job in jobs:
        require(lock['models'][f'{job["key"]}-{job["precision"]}']['manifestSha256'] == sha((ROOT / job['manifest']).read_bytes()), '实验清单发生变化')
    ann = read(ANNOTATIONS)
    ids = [x['id'] for x in ann['images']]
    require(ids == [x['imageId'] for x in lock['images']] and len(ids) == 64 and len(ann['annotations']) == 716, '数据集不完整')
    index_path = REPORT / 'artifact-index.json'
    indexed = {x['path']: x for x in read(index_path)} if not archive else {}
    if not archive: require(len(indexed) == 288, '归档索引不完整或重复')
    records, metrics, rows, archived = {}, {}, [], []
    seen = defaultdict(list)
    for round_no in (1, 2, 3):
        for job in jobs:
            for backend in BACKENDS:
                name = stem(job, backend)
                relative = f'round-{round_no}/{name}.json'
                def load_record(relative):
                    if archive:
                        data = (WORK / relative).read_bytes()
                        path = REPORT / 'evidence' / (relative + '.gz')
                        path.parent.mkdir(parents=True, exist_ok=True)
                        compressed = gzip.compress(data, mtime=0)
                        path.write_bytes(compressed)
                        archived.append({'path': 'evidence/' + relative + '.gz', 'bytes': len(data), 'sha256': sha(data), 'compressedSha256': sha(compressed)})
                    else:
                        path = 'evidence/' + relative + '.gz'
                        entry = indexed[path]
                        compressed = (REPORT / path).read_bytes()
                        require(sha(compressed) == entry['compressedSha256'], '压缩证据摘要错误')
                        data = gzip.decompress(compressed)
                        require(len(data) == entry['bytes'] and sha(data) == entry['sha256'], '证据摘要错误')
                    return data
                raw = load_record(relative)
                value = json.loads(raw)
                binding = json.loads(load_record(relative.replace('.json', '-binding.json')))
                timestamp = validate_record(value, binding, raw, job, backend, round_no, lock)
                prior = seen[name]
                require(all(old_sha != sha(raw) and old_time < timestamp for old_sha, old_time in prior), '复用同一次运行或轮次时间倒序')
                prior.append((sha(raw), timestamp))
                key = (round_no, job['key'], job['precision'], backend)
                records[key] = value
                metrics[key] = evaluate_coco(ann, value['predictions'], ids)
                rows.append({'round': round_no, 'key': job['key'], 'precision': job['precision'], 'backend': backend, 'sha256': sha(raw), 'status': 'passed', 'metrics': metrics[key], 'performance': value['performance'], 'loadTimings': value['loadTimings'], 'artifacts': value['artifacts']})
    for row in rows:
        key = (row['round'], row['key'], row['precision'], row['backend'])
        ref = (row['round'], row['key'], 'fp32', row['backend'])
        row['apDeltaPoints'] = (metrics[key]['metrics']['AP'] - metrics[ref]['metrics']['AP']) * 100
        row['retention'] = parity(records[ref]['predictions'], records[key]['predictions'], ids, .5)
        row['strictRetention'] = parity(records[ref]['predictions'], records[key]['predictions'], ids, .99)
        row['qualityGatePassed'] = quality_pass(row['apDeltaPoints'], row['retention']['fraction'])
        warm = records[key]['images'][1:]
        row['warmInferenceMedianMs'] = statistics.median(x['timings']['inferenceMs'] for x in warm)
    candidates = []
    for job in jobs:
        if job['precision'] == 'fp32': continue
        selected = [x for x in rows if (x['key'], x['precision']) == (job['key'], job['precision'])]
        base = next(x for x in jobs if x['key'] == job['key'] and x['precision'] == 'fp32')
        candidates.append({'key': job['key'], 'precision': job['precision'], 'bytes': job['bytes'], 'sha256': job['sha256'], 'sizeReduction': 1 - job['bytes']/base['bytes'], 'qualityGatePassed': len(selected) == 6 and all(x['qualityGatePassed'] for x in selected), 'minimumApDeltaPoints': min(x['apDeltaPoints'] for x in selected), 'minimumRetention': min(x['retention']['fraction'] for x in selected)})
    result = {'protocolSha256': lock['protocolSha256'], 'sdkSha256': lock['sdkSha256'], 'inputsLockSha256': sha((REPORT / 'inputs.lock.json').read_bytes()), 'browserRunCount': len(rows), 'qualityGate': protocol['qualityGate'], 'candidates': candidates, 'rows': rows, 'qualityGatePassed': all(x['qualityGatePassed'] for x in candidates)}
    if archive: write(index_path, archived)
    write(REPORT / 'summary.json', result)
    # 收据只在完整复算后生成；发布入口核对摘要，防止汇总或原始证据被改动后继续发布。
    bound = ['summary.json', 'artifact-index.json', 'inputs.lock.json', 'jobs.json', 'protocol.json', 'quality.py']
    bound += [x['path'] for x in read(index_path)]
    bound += [(ROOT / job['manifest']).relative_to(REPORT).as_posix() for job in jobs if (ROOT / job['manifest']).is_relative_to(REPORT)]
    write(REPORT / 'quality-receipt.json', {
        'files': {name: sha((REPORT / name).read_bytes()) for name in bound},
        'annotationsSha256': sha(ANNOTATIONS.read_bytes()),
        'evaluationCode': {name: sha((ROOT / 'tools/model-pipeline/evaluation' / name).read_bytes()) for name in ('coco.py', 'matching.py')},
        'browserRunCount': len(rows), 'candidateCount': len(candidates),
    })
    print(json.dumps({'runs': len(rows), 'candidatesPassed': sum(x['qualityGatePassed'] for x in candidates), 'candidates': len(candidates)}))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', action='store_true')
    args = parser.parse_args()
    summarize(args.archive)
