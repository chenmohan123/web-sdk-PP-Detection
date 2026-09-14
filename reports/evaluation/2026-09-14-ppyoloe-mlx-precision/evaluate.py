"""复现 M/L/X 三精度转换、Python 推理与压缩证据归档。"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
WORK = ROOT / '.tmp/precision-mlx-20260914'
DATASET = ROOT / 'reports/evaluation/2026-09-11-ppyoloe/dataset'
IMAGES = ROOT / '.tmp/phase2/dataset/images'
SOURCES = {'m': ROOT / '.tmp/ppyoloe-plus-m-fixed.onnx',
           'l': ROOT / '.tmp/smlx-l/ppyoloe-plus-l-fixed.onnx',
           'x': ROOT / '.tmp/ppyoloe-plus-x-fixed.onnx'}
sys.path.insert(0, str(ROOT / 'tools/model-pipeline'))


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def python_runtime_versions():
    import cv2
    import numpy
    import onnxruntime
    return {'python': platform.python_version(), 'platform': platform.platform(),
            'onnxruntime': onnxruntime.__version__, 'opencv': cv2.__version__, 'numpy': numpy.__version__}


def python_identity(job):
    from evaluation.prepare_subset import verify_image_lock
    lock = read(DATASET / 'images.lock.json')
    verify_image_lock(IMAGES, lock)
    image_set = '\n'.join(f'{item["filename"]}:{item["sha256"]}' for item in lock)
    return {'modelSha256': job['sha256'], 'annotationsSha256': digest(DATASET / 'annotations.json'),
            'imageSetSha256': hashlib.sha256(image_set.encode()).hexdigest(),
            'inferenceScriptSha256': digest(ROOT / 'tools/model-pipeline/ppyoloe/inference.py'),
            'preprocessing': 'OpenCV INTER_CUBIC RGB /255', 'threads': 4,
            'runtimeVersions': python_runtime_versions()}


def bind_python(identity, runtime, predictions):
    return {'identity': identity, 'runtimeSha256': digest(runtime), 'predictionsSha256': digest(predictions)}


def verify_python(binding, identity, runtime_bytes, predictions_bytes):
    if binding.get('identity') != identity:
        raise ValueError('Python 证据输入或配置不一致')
    if binding.get('runtimeSha256') != hashlib.sha256(runtime_bytes).hexdigest():
        raise ValueError('Python 运行报告摘要不一致')
    if binding.get('predictionsSha256') != hashlib.sha256(predictions_bytes).hexdigest():
        raise ValueError('Python 预测摘要不一致')


def prepare():
    import onnx
    from float16_models import PROFILES, convert as fp16
    from weight_only import convert as w8a32
    from evaluation.prepare_subset import verify_image_lock

    WORK.mkdir(parents=True, exist_ok=True)
    verify_image_lock(IMAGES, read(DATASET / 'images.lock.json'))
    assert digest(DATASET / 'annotations.json') == 'd398fc9b09d97135e9b92d28d170681ed50bcd3a5518f16f559e6e379adc1b79'
    jobs = []
    for size, source in SOURCES.items():
        stable = read(ROOT / f'models/ppyoloe-plus-{size}-640/0.1.0/manifest.json')
        expected = stable['variants'][0]['sha256']
        assert digest(source) == expected
        for precision in ('fp32', 'fp16', 'w8a32'):
            model = source if precision == 'fp32' else WORK / f'{size}-{precision}.onnx'
            conversion_path = WORK / f'{size}-{precision}-conversion.json'
            if precision != 'fp32':
                if model.exists():
                    conversion = read(conversion_path)
                    assert digest(model) == (conversion['candidateSha256'] if precision == 'fp16' else conversion['output']['sha256'])
                    assert expected == (conversion['sourceSha256'] if precision == 'fp16' else conversion['source']['sha256'])
                else:
                    if precision == 'fp16':
                        sha, ops, nodes = PROFILES[f'ppyoloe-{size}']
                        conversion = fp16(source, model, expected_sha256=sha, extra_blocked_ops=ops, blocked_nodes=nodes)
                    else:
                        conversion = w8a32(source, model, expected_sha256=expected)
                    write(conversion_path, conversion)
                write(REPORT / conversion_path.name, conversion)
            graph = onnx.load(model, load_external_data=False)
            assert [v.type.tensor_type.elem_type for v in graph.graph.input] == [onnx.TensorProto.FLOAT]
            assert [v.type.tensor_type.elem_type for v in graph.graph.output] == [onnx.TensorProto.FLOAT, onnx.TensorProto.INT32]
            manifest = copy.deepcopy(stable)
            manifest['status'] = 'labs'
            manifest['model']['version'] = '0.1.0-precision-eval.1'
            manifest['limitations'] = ['仅用于桌面精度评估，尚未达到本轮稳定发布门槛。']
            variant = manifest['variants'][0]
            variant.update(id=precision, filename=model.name, precision='int8' if precision == 'w8a32' else precision,
                           quantization='weight-only-int8-activation-fp32' if precision == 'w8a32' else None,
                           opset=next(item.version for item in graph.opset_import if item.domain == ''),
                           bytes=model.stat().st_size, sha256=digest(model), status='labs')
            variant['sources'] = [{'kind': 'custom', 'repository': 'local/ppyoloe-precision-evaluation',
                                   'revision': variant['sha256'], 'path': model.name,
                                   'downloadUrl': f'http://127.0.0.1:4173/{model.name}',
                                   'bytes': variant['bytes'], 'sha256': variant['sha256']}]
            manifest['defaultVariant'], manifest['defaultSource'] = precision, 'custom'
            manifest_path = REPORT / f'{size}-{precision}-manifest.json'
            write(manifest_path, manifest)
            jobs.append({'size': size, 'precision': precision, 'model': model.relative_to(ROOT).as_posix(),
                         'manifest': manifest_path.relative_to(ROOT).as_posix(),
                         'bytes': variant['bytes'], 'sha256': variant['sha256']})
            print(f'{size.upper()} {precision}：{variant["bytes"]:,} bytes，转换/来源校验通过', flush=True)
    write(REPORT / 'jobs.json', jobs)


def python_inference():
    for job in read(REPORT / 'jobs.json'):
        assert digest(ROOT / job['model']) == job['sha256']
        identity = python_identity(job)
        stem = f'{job["size"]}-{job["precision"]}-python'
        runtime = WORK / f'{stem}.json'
        predictions = WORK / f'{stem}-predictions.json'
        binding = WORK / f'{stem}-binding.json'
        if runtime.exists() and predictions.exists() and binding.exists():
            verify_python(read(binding), identity, runtime.read_bytes(), predictions.read_bytes())
            print(f'{stem}：复用本轮完整输出', flush=True)
            continue
        # 缺少绑定的历史结果重新推理；失败时不会留下可复用的完成标记。
        binding.unlink(missing_ok=True)
        print(f'{stem}：开始 64 图推理', flush=True)
        with (WORK / f'{stem}.log').open('w', encoding='utf-8') as log:
            subprocess.run([sys.executable, 'tools/model-pipeline/ppyoloe/inference.py', '--model-kind', 'ppyoloe',
                            '--model', job['model'], '--annotations', str(DATASET / 'annotations.json'),
                            '--images-dir', str(IMAGES), '--predictions', str(predictions), '--report', str(runtime),
                            '--threads', '4'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
        result = read(runtime)
        assert result['modelSha256'] == job['sha256'] and result['preprocessing'] == identity['preprocessing']
        write(binding, bind_python(identity, runtime, predictions))
        print(f'{stem}：完成，AP={result["evaluation"]["metrics"]["AP"]:.6f}', flush=True)


def archive():
    entries = []
    for path in sorted(WORK.glob('*.json')):
        data = path.read_bytes()
        compressed = gzip.compress(data, mtime=0)
        target = REPORT / 'evidence' / f'{path.name}.gz'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(compressed)
        entries.append({'path': target.relative_to(REPORT).as_posix(), 'bytes': len(data),
                        'sha256': hashlib.sha256(data).hexdigest(),
                        'compressedSha256': hashlib.sha256(compressed).hexdigest()})
    write(REPORT / 'artifact-index.json', entries)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('prepare', 'python', 'archive'))
    args = parser.parse_args()
    {'prepare': prepare, 'python': python_inference, 'archive': archive}[args.phase]()
