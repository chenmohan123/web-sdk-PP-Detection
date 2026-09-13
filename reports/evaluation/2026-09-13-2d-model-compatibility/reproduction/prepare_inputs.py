"""下载或校验锁定的源码、SOD 权重和 64 张 COCO 图片，不覆盖已有不同字节。"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[4]
report = Path(__file__).resolve().parents[1]
lock = json.loads((report / 'sources.lock.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--verify-only', action='store_true')
args = parser.parse_args()


def verify(path, evidence):
    if path.stat().st_size != evidence['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != evidence['sha256']:
        raise ValueError(f'摘要不符，保留文件供排查：{path}')


def acquire(path, evidence, url):
    if not path.exists():
        if args.verify_only:
            raise FileNotFoundError(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.download')
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
        verify(temporary, evidence)
        temporary.replace(path)
    verify(path, evidence)


archive = root / '.tmp/phase2/downloads/paddledetection.zip'
acquire(archive, lock['archive'], lock['archive']['url'])
upstream = root / '.tmp/phase2/upstream'
with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
        if item.is_dir():
            continue
        path = (upstream / item.filename).resolve()
        if not path.is_relative_to(upstream.resolve()):
            raise ValueError('源码归档路径越界')
        data = z.read(item)
        if not path.exists():
            if args.verify_only:
                raise FileNotFoundError(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if path.read_bytes() != data:
            raise ValueError(f'源码不同于固定归档：{path}')
weight = root / '.tmp/sod-20260913/ppyoloe_plus_sod_crn_l_80e_coco.pdparams'
acquire(weight, lock['weights'], lock['weights']['url'])
dataset = root / 'reports/evaluation/2026-09-11-ppyoloe/dataset'
images = json.loads((dataset / 'images.lock.json').read_text(encoding='utf-8'))
for image in images:
    acquire(root / '.tmp/phase2/dataset/images' / image['filename'], image, image['sourceUrl'])
annotations = json.loads((dataset / 'annotations.json').read_text(encoding='utf-8'))
if set(image['id'] for image in annotations['images']) != set(image['imageId'] for image in images):
    raise ValueError('标注与图片锁文件的 ID 不一致')
if len(images) != 64:
    raise ValueError('本轮协议要求固定 64 张图')
print('源码归档、全部解压文件、SOD 权重及 64 张图片校验通过')
