"""只读核验本次研究报告、固定来源和压缩证据的完整性。"""
import gzip
import hashlib
import json
from pathlib import Path

report = Path(__file__).resolve().parents[1]
root = Path(__file__).resolve().parents[4]
def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))
def require(condition, message):
    if not condition:
        raise ValueError(message)
for path in report.rglob('*.json'):
    load(path)
lock = load(report / 'sources.lock.json')
require(len(lock['commit']) == 40, '上游 commit 格式不符')
for item in lock['files']:
    data = gzip.decompress((report / item['snapshot']).read_bytes())
    require(len(data) == item['bytes'], f"上游字节数不符：{item['path']}")
    require(hashlib.sha256(data).hexdigest() == item['sha256'], f"上游摘要不符：{item['path']}")
    require(hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == item['blobSha1'], f"上游 blob 不符：{item['path']}")
evidence = {}
for item in load(report / 'evidence-index.json'):
    compressed = (report / item['path']).read_bytes()
    require(len(compressed) == item['bytes'] and hashlib.sha256(compressed).hexdigest() == item['sha256'], f"压缩证据不符：{item['path']}")
    raw = gzip.decompress(compressed)
    require(len(raw) == item['uncompressedBytes'] and hashlib.sha256(raw).hexdigest() == item['uncompressedSha256'], f"原始证据不符：{item['path']}")
    if item['path'].endswith('.json.gz'):
        evidence[Path(item['path']).name[:-3]] = json.loads(raw)
summary = load(report / 'ppyoloe-sod-conversion.json')
candidate = next(c for c in load(report / 'candidates.json')['candidates'] if c['id'] == 'pp-ppyoloe-sod')
require(summary['status'] == candidate['status'] == 'selected', 'SOD 状态不一致')
require(candidate['estimatedBytes']['fp32'] == summary['onnx']['bytes'], '模型大小不一致')
model_hash = summary['onnx']['sha256']
require(evidence['onnx-runtime.json']['modelSha256'] == evidence['pillow-runtime.json']['modelSha256'] == model_hash, 'Python 模型摘要不一致')
require(hashlib.sha256((root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_bytes()).hexdigest() == summary['pythonReference']['annotationsSha256'], '64 图标注摘要不符')
manifest_hash = hashlib.sha256(gzip.decompress((report / 'evidence/candidate-manifest.json.gz').read_bytes())).hexdigest()
for backend in ('wasm','webgpu'):
    b = evidence[f'browser-{backend}.json']
    require(b['status'] == 'passed' and b['runtime']['backend'] == backend and b['runtime']['mode'] == 'main' and not b['runtime']['fallbacks'], '浏览器实际模式或结果不符')
    require(b['artifacts']['model']['sha256'] == model_hash and b['artifacts']['manifest']['sha256'] == manifest_hash, '浏览器模型或清单摘要不一致')
    rows = evidence[f'browser-{backend}-parity.json']
    require(len(rows) == 8 and all(r['unmatchedReferenceCount'] == r['unmatchedCandidateCount'] == 0 for r in rows), '浏览器参考对齐失败')
    require(sum(r['matchedCount'] for r in rows) == summary['browserSmoke'][backend]['comparison']['matchedCount'], '浏览器匹配统计不一致')
for item in load(report / 'upstream-tree-scan.json'):
    require(not item['truncated'] and len(item['treeSha']) == 40 and item['entryCount'] == 2486 and not item['matches'], '源码树扫描记录不符')
print('全部 JSON、9 份上游快照、15 份压缩证据和 SOD 状态一致性通过')
