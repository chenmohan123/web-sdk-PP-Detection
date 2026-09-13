"""归档 M/X 原始证据并离线重算；L 复用同摘要的既有评测。"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
sys.path.insert(0, str(ROOT/'tools/model-pipeline'))
from evaluation import compare_detections, evaluate_coco


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def parity(reference, candidate, ids):
    rows = [compare_detections([r for r in reference if r['image_id'] == i], [r for r in candidate if r['image_id'] == i], iou_threshold=0.99, score_threshold=0.5) for i in ids]
    value = {key: sum(r[key] for r in rows) for key in ['matchedCount', 'unmatchedReferenceCount', 'unmatchedCandidateCount']}
    value['maxBboxDeltaPixels'] = max(r['maxBboxDeltaPixels'] or 0 for r in rows)
    value['maxScoreDelta'] = max(r['maxScoreDelta'] or 0 for r in rows)
    assert value['unmatchedReferenceCount'] == value['unmatchedCandidateCount'] == 0, value
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', action='store_true')
    archive = parser.parse_args().archive
    files = [f'mx-{v}-{name}.json' for v in ['m', 'x'] for name in ['predictions', 'runtime', 'wasm', 'webgpu', 'paddle-predictions', 'paddle-reference']]
    files += [f'ppyoloe-{v}-fix.json' for v in ['m', 'x']]
    files += [f'ppyoloe-plus-{v}-manifest.json' for v in ['m', 'x']]
    evidence = REPORT/'evidence'
    evidence.mkdir(exist_ok=True)
    index = []
    data = {}
    for name in files:
        if archive:
            raw = (ROOT/'.tmp'/name).read_bytes()
            (evidence/(name+'.gz')).write_bytes(gzip.compress(raw, mtime=0))
        compressed = (evidence/(name+'.gz')).read_bytes()
        raw = gzip.decompress(compressed)
        index.append(dict(path='evidence/'+name+'.gz', bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), compressedSha256=hashlib.sha256(compressed).hexdigest()))
        data[name] = json.loads(raw)
    dataset = read(ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json')
    ids = [image['id'] for image in dataset['images']]
    results = {}
    for v in ['m', 'x']:
        runtime = data[f'mx-{v}-runtime.json']
        manifest = read(ROOT/f'models/ppyoloe-plus-{v}-640/0.1.0/manifest.json')
        expected = manifest['variants'][0]
        assert runtime['modelSha256'] == expected['sha256']
        result = dict(bytes=expected['bytes'], sha256=expected['sha256'], pythonOpenCV=evaluate_coco(dataset, data[f'mx-{v}-predictions.json'], ids)['metrics'], paddleParity=parity(data[f'mx-{v}-paddle-predictions.json'], data[f'mx-{v}-predictions.json'], ids), browser={})
        assert result['pythonOpenCV'] == runtime['evaluation']['metrics']
        for backend in ['wasm', 'webgpu']:
            browser = data[f'mx-{v}-{backend}.json']
            assert browser['status'] == 'passed'
            assert browser['artifacts']['model']['sha256'] == expected['sha256']
            assert browser['runtime']['backend'] == backend and browser['runtime']['mode'] == 'main' and not browser['runtime']['fallbacks']
            assert len(browser['images']) == 64
            result['browser'][backend] = dict(metrics=evaluate_coco(dataset, browser['predictions'], ids)['metrics'], performance=browser['performance'], environment=browser['environment'], runtimeVersions=browser['runtimeVersions'])
        result['browserParity'] = parity(data[f'mx-{v}-wasm.json']['predictions'], data[f'mx-{v}-webgpu.json']['predictions'], ids)
        results[v] = result
    ordinary = read(ROOT/'reports/evaluation/2026-09-13-sod-comparison/summary.json')
    l_manifest = read(ROOT/'models/ppyoloe-plus-l-640/0.1.0/manifest.json')
    assert ordinary['models']['ordinary']['sha256'] == l_manifest['variants'][0]['sha256']
    results['l'] = dict(bytes=l_manifest['variants'][0]['bytes'], sha256=l_manifest['variants'][0]['sha256'], source='reports/evaluation/2026-09-13-sod-comparison/summary.json', pythonOpenCV=ordinary['cpu']['ordinary']['opencv']['metrics'], browser=ordinary['browser']['ordinary'], paddleParity=ordinary['ordinaryPaddleParity'])
    summary = dict(dataset=dict(imageCount=64, groundTruthCount=716, annotationsSha256=hashlib.sha256((ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_bytes()).hexdigest()), models=results, limitations=['COCO 固定场景子集不是完整 COCO mAP。', 'M/X 浏览器使用原 JPEG，Python 官方参考使用 OpenCV；逐框分别比较 Paddle→ONNX 与 WASM→WebGPU，不跨预处理套用参考。', 'L 复用相同 ONNX SHA-256 的旧证据，WebGPU64图、WASM8图，浏览器使用像素相等的 PNG。', '新增规格无手机实测；体积不代表运行内存峰值。'])
    if archive:
        (REPORT/'evidence-index.json').write_text(json.dumps(index, indent=2)+'\n', encoding='utf-8')
        (REPORT/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    else:
        assert index == read(REPORT/'evidence-index.json')
        assert summary == read(REPORT/'summary.json')
    print(json.dumps({k: {'AP': v['pythonOpenCV']['AP'], 'paddleParity': v['paddleParity']} for k,v in results.items()}, ensure_ascii=True))


if __name__ == '__main__':
    main()
