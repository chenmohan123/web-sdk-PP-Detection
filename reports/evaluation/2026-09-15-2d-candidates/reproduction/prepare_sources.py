"""固定本批次候选来源；只下载官方已列出的 Tiny 权重，不发布产物。"""
import argparse
import gzip
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

REVISION = 'b25522a0f4bde8c80603f3ba5e3472059972e3b5'
ARCHIVE_SHA = 'd22c0e8777d749cb967cc71671d1357e1656c76db16f76578a4edb1454d027f6'
WEIGHT_URL = 'https://paddledet.bj.bcebos.com/models/ppyolo_tiny_650e_coco.pdparams'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    report = Path(__file__).resolve().parents[1]
    upstream = args.cache / f'upstream/PaddleDetection-{REVISION}'
    archive = args.cache / 'downloads/paddledetection.zip'
    if digest(archive.read_bytes()) != ARCHIVE_SHA:
        raise ValueError('上游源码压缩包摘要不一致')
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            if not entry.is_dir() and (upstream.parent / entry.filename).read_bytes() != source.read(entry):
                raise ValueError(f'上游源码与固定压缩包不一致：{entry.filename}')
    import yaml
    paths = {'LICENSE', 'configs/ppyolo/README.md', 'configs/fcos/README.md', 'configs/ssd/README.md',
             'deploy/EXPORT_ONNX_MODEL.md', 'tools/export_model.py', 'ppdet/modeling/architectures/yolo.py',
             'ppdet/modeling/post_process.py', 'ppdet/modeling/layers.py'}
    configs = ['configs/ppyolo/ppyolo_tiny_650e_coco.yml', 'configs/fcos/fcos_r50_fpn_1x_coco.yml',
               'configs/ssd/ssd_mobilenet_v1_300_120e_voc.yml', 'configs/ssd/ssdlite_mobilenet_v3_small_320_coco.yml']

    def collect(relative):
        if relative in paths:
            return
        paths.add(relative)
        # 只读取配置继承关系，不实例化训练调度器等 Paddle 自定义 YAML 标签。
        node = yaml.compose((upstream / relative).read_text(encoding='utf-8'))
        bases = next((value for key, value in node.value if key.value == '_BASE_'), None)
        for base in ([] if bases is None else [item.value for item in bases.value]):
            collect((upstream / relative).parent.joinpath(base).resolve().relative_to(upstream.resolve()).as_posix())

    for config in configs:
        collect(config)
    files = []
    for relative in sorted(paths):
        content = (upstream / relative).read_bytes()
        snapshot = report / 'upstream' / (relative + '.gz')
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_bytes(gzip.compress(content, mtime=0))
        files.append({'path': relative, 'bytes': len(content), 'sha256': digest(content),
                      'snapshot': snapshot.relative_to(report).as_posix(),
                      'url': f'https://github.com/PaddlePaddle/PaddleDetection/blob/{REVISION}/{relative}'})
    if WEIGHT_URL not in (upstream / 'configs/ppyolo/README.md').read_text(encoding='utf-8'):
        raise ValueError('Tiny权重未在固定官方表中找到')
    args.work.mkdir(parents=True, exist_ok=True)
    weight = args.work / 'ppyolo_tiny_650e_coco.pdparams'
    existing = report / 'sources.lock.json'
    if not weight.exists():
        with urllib.request.urlopen(WEIGHT_URL, timeout=60) as response:
            weight.write_bytes(response.read())
    content = weight.read_bytes()
    identity = {'url': WEIGHT_URL, 'bytes': len(content), 'sha256': digest(content)}
    if existing.exists() and json.loads(existing.read_text(encoding='utf-8'))['weights'] != identity:
        raise ValueError('下载权重与已固定摘要不一致')
    lock = {'checkedAt': '2026-09-15', 'upstreamRevision': REVISION,
            'archive': {'bytes': archive.stat().st_size, 'sha256': ARCHIVE_SHA,
                        'url': f'https://github.com/PaddlePaddle/PaddleDetection/archive/{REVISION}.zip'},
            'archiveAndExtractedFilesVerified': True, 'files': files, 'weights': identity,
            'license': {'repository': 'Apache-2.0', 'officialWeightLinked': True,
                        'separateWeightLicenseFoundInReviewedSources': False,
                        'distribution': '本轮仅本地评估；正式发布时保留许可、上游来源和转换归因，并核验双源模型卡'}}
    existing.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(files), 'weights': identity}, ensure_ascii=False))


if __name__ == '__main__':
    main()
