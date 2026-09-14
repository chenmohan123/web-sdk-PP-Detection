"""复算三轮浏览器识别门槛，并保留每轮原始记录与协议绑定。"""
from __future__ import annotations

import argparse
import contextlib
import gzip
import hashlib
import io
import json
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
WORK = ROOT / '.tmp/precision-mlx-release-20260914'
ROUND1_COMMIT = 'e4814a44d42be5e213ef416cd0dfb2d7932c2340'
PARITY_KEY_FIELDS = (
    'referenceCount', 'candidateCount', 'matchedCount',
    'unmatchedReferenceCount', 'unmatchedCandidateCount', 'matchedReferenceFraction',
)
sys.path.insert(0, str(ROOT / 'tools/model-pipeline'))
from evaluation import compare_detections, evaluate_coco


def require(condition, message):
    if not condition:
        raise ValueError(message)


def require_equal(actual, expected, message):
    if actual != expected:
        raise ValueError(f'{message}：{actual!r} != {expected!r}')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def parse_json(data, label):
    try:
        return json.loads(data)
    except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f'{label} 不是有效 JSON：{error}') from error


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def safe_path(base, relative, label):
    require(isinstance(relative, str) and relative, f'{label} 路径无效')
    relative_path = Path(relative)
    require(not relative_path.is_absolute(), f'{label} 不得使用绝对路径')
    base = base.resolve()
    target = (base / relative_path).resolve()
    require(base in target.parents, f'{label} 越出证据目录：{relative}')
    return target


def git_blob(commit, path):
    require(commit == ROUND1_COMMIT, '第一轮固定提交不匹配')
    result = subprocess.run(
        ['git', 'show', f'{commit}:{path}'], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    require(
        result.returncode == 0,
        f'无法读取固定提交中的 {path}：{result.stderr.decode("utf-8", errors="replace").strip()}',
    )
    return result.stdout


def parity(reference, candidate, image_ids, iou_threshold, score_threshold):
    grouped = []
    for predictions in (reference, candidate):
        images = defaultdict(list)
        for item in predictions:
            images[item['image_id']].append(item)
        grouped.append(images)
    results = [
        compare_detections(
            grouped[0][image_id], grouped[1][image_id],
            iou_threshold=iou_threshold, score_threshold=score_threshold,
        )
        for image_id in image_ids
    ]
    counts = {
        name: sum(result[name] for result in results)
        for name in (
            'referenceCount', 'candidateCount', 'matchedCount',
            'unmatchedReferenceCount', 'unmatchedCandidateCount',
        )
    }
    counts['matchedReferenceFraction'] = (
        counts['matchedCount'] / counts['referenceCount'] if counts['referenceCount'] else None
    )
    for name in ('maxScoreDelta', 'maxBboxDeltaPixels'):
        counts[name] = max((result[name] for result in results if result[name] is not None), default=None)
    return counts


def require_unique_axis(matrix, name):
    values = matrix.get(name)
    require(isinstance(values, list) and values, f'matrix.{name} 必须是非空数组')
    require(len(values) == len(set(values)), f'matrix.{name} 存在重复值')
    return values


def same_members(actual, expected):
    return len(actual) == len(expected) and set(actual) == set(expected)


def runtime_precision(precision):
    require(precision in ('fp32', 'fp16', 'w8a32'), f'不支持的精度：{precision}')
    return 'int8' if precision == 'w8a32' else precision


def validate_protocol_and_jobs(protocol, jobs, fixed_summary):
    require_equal(protocol['round1']['commit'], ROUND1_COMMIT, '第一轮固定提交不匹配')
    matrix = protocol.get('matrix')
    require(isinstance(matrix, dict), '缺少 matrix')
    sizes = require_unique_axis(matrix, 'sizes')
    precisions = require_unique_axis(matrix, 'precisions')
    backends = require_unique_axis(matrix, 'backends')
    rounds = require_unique_axis(matrix, 'rounds')
    require_equal(rounds, [1, 2, 3], '发布证据必须严格包含第 1、2、3 轮')
    require(precisions[0] == 'fp32', 'precision 轴必须以 fp32 基线开始')
    require(all(backend in ('wasm', 'webgpu') for backend in backends), 'backend 轴包含不支持的值')
    require(isinstance(matrix.get('wasmThreads'), int) and matrix['wasmThreads'] > 0,
            'matrix.wasmThreads 必须是正整数')
    require(isinstance(matrix.get('executionMode'), str) and matrix['executionMode'],
            'matrix.executionMode 无效')
    require(isinstance(matrix.get('allowFallback'), bool), 'matrix.allowFallback 必须是布尔值')
    require(isinstance(protocol['dataset'].get('imageCount'), int) and protocol['dataset']['imageCount'] > 0,
            'dataset.imageCount 必须是正整数')
    require(isinstance(protocol['qualityGate'].get('scoreThreshold'), (int, float)),
            'qualityGate.scoreThreshold 无效')

    fixed_sizes = list(fixed_summary['models'])
    fixed_precisions = list(fixed_summary['models'][fixed_sizes[0]])
    fixed_backends = [
        backend
        for backend in fixed_summary['models'][fixed_sizes[0]][fixed_precisions[0]]['backends']
        if backend != 'python'
    ]
    require(same_members(sizes, fixed_sizes), 'size 轴与固定第一轮摘要不一致')
    require(same_members(precisions, fixed_precisions), 'precision 轴与固定第一轮摘要不一致')
    require(same_members(backends, fixed_backends), 'backend 轴与固定第一轮摘要不一致')
    for size in sizes:
        require(same_members(list(fixed_summary['models'][size]), precisions),
                f'固定第一轮摘要的 precision 轴不完整：{size}')
        for precision in precisions:
            summary_backends = [
                backend for backend in fixed_summary['models'][size][precision]['backends']
                if backend != 'python'
            ]
            require(same_members(summary_backends, backends),
                    f'固定第一轮摘要的 backend 轴不完整：{size}/{precision}')

    require(isinstance(jobs, list), 'jobs 必须是数组')
    jobs_by_key = {}
    for job in jobs:
        key = (job.get('size'), job.get('precision'))
        require(key not in jobs_by_key, f'jobs 存在重复组合：{key[0]}/{key[1]}')
        jobs_by_key[key] = job
    expected_keys = {(size, precision) for size in sizes for precision in precisions}
    require_equal(set(jobs_by_key), expected_keys, 'jobs 未完整覆盖 size/precision 笛卡尔积')
    for key, job in jobs_by_key.items():
        fixed = fixed_summary['models'][key[0]][key[1]]
        require_equal(job['bytes'], fixed['bytes'], f'job bytes 与固定摘要不一致：{key[0]}/{key[1]}')
        require_equal(job['sha256'], fixed['sha256'], f'job SHA 与固定摘要不一致：{key[0]}/{key[1]}')
    return sizes, precisions, backends, rounds, jobs_by_key


def expected_evaluation(protocol, job, backend):
    return {
        'allowExperimental': True,
        'allowFallback': protocol['matrix']['allowFallback'],
        'executionMode': protocol['matrix']['executionMode'],
        'expectedImages': protocol['dataset']['imageCount'],
        'manifestOverrides': {'iouThreshold': 1, 'scoreThreshold': 0.001},
        'numThreads': protocol['matrix']['wasmThreads'],
        'preprocessing': {'interpolation': 'bicubic', 'reference': 'Pillow bicubic'},
        'requestedBackend': backend,
        'precision': runtime_precision(job['precision']),
        'scoreThreshold': 0.001,
    }


def archive(protocol):
    entries = []
    for round_no in protocol['matrix']['rounds']:
        if round_no == 1:
            continue
        for path in sorted((WORK / f'round-{round_no}').glob('*.json')):
            data = path.read_bytes()
            compressed = gzip.compress(data, mtime=0)
            relative = f'evidence/round-{round_no}/{path.name}.gz'
            target = REPORT / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(compressed)
            entries.append({
                'round': round_no, 'path': relative, 'bytes': len(data),
                'sha256': sha(data), 'compressedSha256': sha(compressed),
            })
    write(REPORT / 'artifact-index.json', entries)


def load_index(records, directory, index_bytes, index_sha, fixed_round=None):
    entries = parse_json(index_bytes, f'{directory} artifact-index.json')
    require(isinstance(entries, list), f'{directory} artifact-index.json 必须是数组')
    seen_paths = set()
    for entry in entries:
        require(isinstance(entry, dict), f'{directory} 索引条目无效')
        relative = entry.get('path')
        require(relative not in seen_paths, f'{directory} 索引路径重复：{relative}')
        seen_paths.add(relative)
        compressed = safe_path(directory, relative, '索引条目').read_bytes()
        require_equal(sha(compressed), entry.get('compressedSha256'), f'压缩证据 SHA 不匹配：{relative}')
        try:
            data = gzip.decompress(compressed)
        except (gzip.BadGzipFile, EOFError) as error:
            raise ValueError(f'压缩证据无法解压：{relative}') from error
        require_equal(len(data), entry.get('bytes'), f'证据字节数不匹配：{relative}')
        require_equal(sha(data), entry.get('sha256'), f'证据 SHA 不匹配：{relative}')
        round_no = fixed_round if fixed_round is not None else entry.get('round')
        require(isinstance(round_no, int), f'索引条目缺少有效 round：{relative}')
        name = Path(relative).name.removesuffix('.gz')
        key = (round_no, name)
        require(key not in records, f'证据记录重复：第 {round_no} 轮 {name}')
        records[key] = {
            'data': data,
            'indexSha256': index_sha,
            'path': relative,
            'source': directory,
        }


def parsed_timestamp(value, label):
    require(isinstance(value, str) and value, f'{label} 缺少 capturedAt')
    try:
        captured = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise ValueError(f'{label} 的 capturedAt 无效：{value}') from error
    require(captured.tzinfo is not None, f'{label} 的 capturedAt 必须包含时区')
    return captured


def parity_keys(value):
    return {name: value[name] for name in PARITY_KEY_FIELDS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', action='store_true')
    args = parser.parse_args()
    protocol_bytes = (REPORT / 'protocol.json').read_bytes()
    protocol = parse_json(protocol_bytes, 'protocol.json')
    protocol_sha = sha(protocol_bytes)
    require_equal(protocol['round1']['commit'], ROUND1_COMMIT, '第一轮固定提交不匹配')
    if args.archive:
        archive(protocol)
    initial = ROOT / protocol['round1']['report']
    fixed_summary_bytes = (initial / 'summary.json').read_bytes()
    require_equal(sha(fixed_summary_bytes), protocol['round1']['summarySha256'], '第一轮 summary SHA 不匹配')
    previous = parse_json(fixed_summary_bytes, '第一轮 summary.json')

    round1_index_path = f'{protocol["round1"]["report"].replace(chr(92), "/")}/artifact-index.json'
    local_round1_index = (initial / 'artifact-index.json').read_bytes()
    committed_round1_index = git_blob(ROUND1_COMMIT, round1_index_path)
    require_equal(local_round1_index, committed_round1_index,
                  '第一轮 artifact-index.json 与固定提交中的同路径文件字节不一致')
    round1_index_sha = sha(committed_round1_index)
    current_index_bytes = (REPORT / 'artifact-index.json').read_bytes()
    current_index_sha = sha(current_index_bytes)

    jobs = read(ROOT / protocol['jobs'])
    sizes, precisions, backends, rounds, jobs_by_key = validate_protocol_and_jobs(protocol, jobs, previous)
    expected_browser_runs = len(sizes) * len(precisions) * len(backends) * len(rounds)
    require_equal(expected_browser_runs, 54, '协议矩阵必须定义 54 项浏览器运行')

    records = {}
    load_index(records, initial, committed_round1_index, round1_index_sha, fixed_round=1)
    load_index(records, REPORT, current_index_bytes, current_index_sha)
    expected_repeated_records = {
        (round_no, name)
        for round_no in rounds if round_no != 1
        for size in sizes
        for precision in precisions
        for backend in backends
        for name in (
            f'{size}-{precision}-{backend}.json',
            f'{size}-{precision}-{backend}-binding.json',
        )
    }
    actual_repeated_records = {
        key for key, record in records.items() if record['source'] == REPORT
    }
    require_equal(actual_repeated_records, expected_repeated_records,
                  '重复轮次归档未完整且唯一地覆盖结果与 binding')

    parsed_results = {}
    for size in sizes:
        for precision in precisions:
            for backend in backends:
                stem = f'{size}-{precision}-{backend}'
                result_hashes = set()
                captured_values = set()
                previous_time = None
                for round_no in rounds:
                    name = f'{stem}.json'
                    record = records.get((round_no, name))
                    require(record is not None, f'缺少第 {round_no} 轮 {name}')
                    result = parse_json(record['data'], f'第 {round_no} 轮 {name}')
                    result_sha = sha(record['data'])
                    captured_at = result.get('capturedAt')
                    captured_time = parsed_timestamp(captured_at, f'第 {round_no} 轮 {stem}')
                    require(result_sha not in result_hashes, f'{stem} 的三轮 resultSha256 不互异')
                    require(captured_at not in captured_values, f'{stem} 的三轮 capturedAt 不互异')
                    if previous_time is not None:
                        require(captured_time > previous_time, f'{stem} 的 capturedAt 未按轮次严格递增')
                    result_hashes.add(result_sha)
                    captured_values.add(captured_at)
                    previous_time = captured_time
                    if round_no != 1:
                        binding_name = f'{stem}-binding.json'
                        binding_record = records.get((round_no, binding_name))
                        require(binding_record is not None, f'缺少第 {round_no} 轮 {binding_name}')
                        binding = parse_json(binding_record['data'], f'第 {round_no} 轮 {binding_name}')
                        require_equal(
                            binding,
                            {'round': round_no, 'protocolSha256': protocol_sha, 'resultSha256': result_sha},
                            f'第 {round_no} 轮 {stem} 的协议绑定不一致',
                        )
                    parsed_results[(round_no, size, precision, backend)] = {
                        'capturedAt': captured_at,
                        'indexSha256': record['indexSha256'],
                        'result': result,
                        'resultSha256': result_sha,
                    }

    dataset_path = ROOT / protocol['dataset']['annotations']
    require_equal(sha(dataset_path.read_bytes()), protocol['dataset']['sha256'], '数据集标注 SHA 不匹配')
    dataset = read(dataset_path)
    image_ids = [item['id'] for item in dataset['images']]
    require_equal(len(image_ids), len(set(image_ids)), '数据集 image id 存在重复')
    require_equal(len(image_ids), protocol['dataset']['imageCount'], '数据集图片数量与协议不一致')
    require_equal(len(dataset['annotations']), protocol['dataset']['groundTruthCount'], '标注数量与协议不一致')
    expected_image_set = previous['dataset']['browserImageSetSha256']
    criteria = protocol['qualityGate']
    score_threshold = criteria['scoreThreshold']
    gate_iou = criteria['iouThreshold']
    diagnostic_iou = protocol['diagnostics']['strictIouThreshold']
    require_equal(protocol['diagnostics']['blocksRelease'], False, '严格 IoU 只能作为非阻塞诊断')
    # 离线复算以固定 Git tree 的第一轮原始证据为身份根，无需 ONNX 本体或已构建 bundle。
    first_result = parsed_results[(1, sizes[0], precisions[0], backends[0])]['result']
    sdk_sha = first_result['artifacts']['sdk']['sha256']

    summary = {
        'protocolSha256': protocol_sha,
        'criteria': criteria,
        'diagnostics': protocol['diagnostics'],
        'dataset': protocol['dataset'],
        'round1Commit': ROUND1_COMMIT,
        'evidenceIndexes': {
            'round1': {'sha256': round1_index_sha, 'commit': ROUND1_COMMIT},
            'repeatedRounds': {'sha256': current_index_sha},
        },
        'rows': [],
        'pythonReference': {
            'evidenceType': 'single-run-diagnostic',
            'runCount': 1,
            'blocksRelease': False,
            'rows': [],
        },
        'qualityGateScope': 'three-round-browser-results',
        'qualityGatePassed': True,
    }
    environment_identity = None
    environment = None
    gpu_adapter_identity = None
    for round_no in rounds:
        for size in sizes:
            references = {}
            for precision in precisions:
                job = jobs_by_key[(size, precision)]
                manifest_sha = sha((ROOT / job['manifest']).read_bytes())
                for backend in backends:
                    evidence = parsed_results[(round_no, size, precision, backend)]
                    result = evidence['result']
                    label = f'第 {round_no} 轮 {size}/{precision}/{backend}'
                    require_equal(result.get('status'), 'passed', f'{label} 状态不是 passed')
                    require_equal(result.get('evaluation'), expected_evaluation(protocol, job, backend),
                                  f'{label} 的 evaluation 与协议不一致')
                    runtime = result['runtime']
                    require_equal(runtime['requestedBackend'], backend, f'{label} 的请求后端不一致')
                    require_equal(runtime['backend'], backend, f'{label} 的实际后端不一致')
                    require_equal(runtime['mode'], protocol['matrix']['executionMode'], f'{label} 的执行模式不一致')
                    if not protocol['matrix']['allowFallback']:
                        require_equal(runtime['fallbacks'], [], f'{label} 发生了协议禁止的回退')
                    expected_precision = runtime_precision(precision)
                    require_equal(runtime['precision'], expected_precision, f'{label} 的运行时精度不一致')
                    require_equal(result['model']['bytes'], job['bytes'], f'{label} 的模型字节数不一致')
                    require_equal(result['model']['precision'], expected_precision, f'{label} 的模型精度不一致')
                    require_equal(result['artifacts']['sdk']['sha256'], sdk_sha, f'{label} 的 SDK SHA 不匹配')
                    require_equal(result['artifacts']['model']['sha256'], job['sha256'], f'{label} 的模型 SHA 不匹配')
                    require_equal(result['artifacts']['manifest']['sha256'], manifest_sha, f'{label} 的 manifest SHA 不匹配')
                    require_equal(result['artifacts']['annotations']['sha256'], protocol['dataset']['sha256'],
                                  f'{label} 的标注 SHA 不匹配')
                    require_equal(result['artifacts']['imageSetSha256'], expected_image_set,
                                  f'{label} 的图片集 SHA 不匹配')
                    require_equal([item['imageId'] for item in result['images']], image_ids,
                                  f'{label} 的图片顺序不一致')
                    identity = {
                        'sdkSha256': result['artifacts']['sdk']['sha256'],
                        'runtimeVersions': result['runtimeVersions'],
                        'browserVersion': result['environment']['browser']['version'],
                        'cpu': result['environment']['cpu'],
                        'os': result['environment']['os'],
                    }
                    if environment_identity is None:
                        environment_identity = identity
                        environment = {key: result['environment'][key] for key in ('cpu', 'os', 'browser')}
                        summary['runtimeVersions'] = result['runtimeVersions']
                        summary['sdkSha256'] = sdk_sha
                    require_equal(identity, environment_identity,
                                  '三轮必须使用相同 SDK、运行时、浏览器和设备')
                    if backend == 'webgpu':
                        gpu = result['environment']['gpu']
                        require_equal(gpu.get('physical'), True, f'{label} 未使用物理 WebGPU 适配器')
                        adapter = gpu.get('adapter')
                        require(isinstance(adapter, dict), f'{label} 缺少 WebGPU adapter')
                        for field in ('vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'):
                            require(field in adapter, f'{label} adapter 缺少 {field}')
                        require_equal(adapter['isFallbackAdapter'], False, f'{label} 使用了 fallback adapter')
                        if gpu_adapter_identity is None:
                            gpu_adapter_identity = adapter
                        require_equal(adapter, gpu_adapter_identity,
                                      f'{label} 的 WebGPU adapter 身份与其他记录不一致')
                    predictions = result['predictions']
                    require(all(item['image_id'] in image_ids for item in predictions),
                            f'{label} 包含数据集外的 prediction image_id')
                    with contextlib.redirect_stdout(io.StringIO()):
                        metrics = evaluate_coco(dataset, predictions, image_ids)['metrics']
                    if precision == 'fp32':
                        references[backend] = (metrics, predictions)
                    require(backend in references, f'{label} 缺少 fp32 基线')
                    baseline, baseline_predictions = references[backend]
                    recognition = parity(
                        baseline_predictions, predictions, image_ids, gate_iou, score_threshold,
                    )
                    strict = parity(
                        baseline_predictions, predictions, image_ids, diagnostic_iou, score_threshold,
                    )
                    require(strict['matchedCount'] <= recognition['matchedCount'],
                            f'{label} 的严格 IoU 匹配数不能高于发布口径')
                    ap_delta = (metrics['AP'] - baseline['AP']) * 100
                    retention = recognition['matchedReferenceFraction']
                    passed = (
                        ap_delta >= -criteria['maximumApDropPoints']
                        and retention is not None
                        and retention >= criteria['minimumReferenceRetention']
                    )
                    if round_no == 1:
                        fixed = previous['models'][size][precision]['backends'][backend]
                        require_equal(metrics, fixed['metrics'], f'{label} 重算 metrics 与固定摘要不一致')
                        require_equal(metrics['AP'], fixed['metrics']['AP'], f'{label} 重算 AP 与固定摘要不一致')
                        require_equal(ap_delta, fixed['apDeltaPoints'], f'{label} 重算 AP 差值与固定摘要不一致')
                        require_equal(parity_keys(recognition), parity_keys(fixed['diagnosticParity']),
                                      f'{label} 发布 parity 关键计数与固定摘要不一致')
                        require_equal(parity_keys(strict), parity_keys(fixed['strictParity']),
                                      f'{label} 严格 parity 关键计数与固定摘要不一致')
                    summary['rows'].append({
                        'round': round_no,
                        'size': size,
                        'precision': precision,
                        'backend': backend,
                        'bytes': job['bytes'],
                        'sha256': job['sha256'],
                        'metrics': metrics,
                        'apDeltaPoints': ap_delta,
                        'recognitionParity': recognition,
                        'strictParity': strict,
                        'strictParityBlocksRelease': False,
                        'qualityGatePassed': passed,
                        'performance': {
                            **result['performance'],
                            'warmInferenceMedianMs': statistics.median(
                                item['timings']['inferenceMs'] for item in result['images'][1:]
                            ),
                        },
                        'capturedAt': evidence['capturedAt'],
                        'evidenceSha256': evidence['resultSha256'],
                        'evidenceIndexSha256': evidence['indexSha256'],
                    })
                    summary['qualityGatePassed'] = summary['qualityGatePassed'] and passed
                    print(
                        f'第 {round_no} 轮 {size}/{precision}/{backend}: '
                        f'AP={metrics["AP"]*100:.3f}, 保留={retention*100:.2f}%, {passed}',
                        flush=True,
                    )

    candidate_precisions = [precision for precision in precisions if precision != 'fp32']
    require_equal(len(sizes) * len(candidate_precisions), 6, '旧 Python 诊断必须恰好包含六项')
    for size in sizes:
        for precision in candidate_precisions:
            row = previous['models'][size][precision]['backends']['python']
            retention = row['diagnosticParity']['matchedReferenceFraction']
            diagnostic_passed = (
                row['apDeltaPoints'] >= -criteria['maximumApDropPoints']
                and retention is not None
                and retention >= criteria['minimumReferenceRetention']
            )
            summary['pythonReference']['rows'].append({
                'size': size,
                'precision': precision,
                'evidenceType': 'single-run-diagnostic',
                'runCount': 1,
                'blocksRelease': False,
                'apDeltaPoints': row['apDeltaPoints'],
                'recognitionParity': row['diagnosticParity'],
                'diagnosticPassed': diagnostic_passed,
            })
    require(gpu_adapter_identity is not None, '三轮证据缺少 WebGPU adapter 身份')
    summary['webgpuAdapter'] = {
        'physical': True,
        'fallback': False,
        'identity': gpu_adapter_identity,
    }
    summary['environment'] = environment
    summary['browserRunCount'] = len(summary['rows'])
    require_equal(summary['browserRunCount'], expected_browser_runs, '浏览器运行数与协议矩阵不一致')
    write(REPORT / 'summary.json', summary)
    if not summary['qualityGatePassed']:
        raise SystemExit('存在未通过质量门槛的浏览器变体；禁止进入稳定发布。')


if __name__ == '__main__':
    main()
