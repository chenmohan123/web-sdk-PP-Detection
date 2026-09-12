"""一次性实验：核对固定模型、数据集与 SDK 字节，不转换模型。"""
from pathlib import Path
import hashlib, json, urllib.request, datetime, subprocess, sys

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.tmp/tiling-20260912/models'
CACHE.mkdir(parents=True, exist_ok=True)
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
models = []
for name, relative in [('picodet','models/pp-detection/1.0.2/manifest.json'),('ppyoloe','models/ppyoloe-plus-s-640/0.1.1/manifest.json')]:
    manifest_path = ROOT / relative
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for variant in manifest['variants']:
        kind = variant['id']
        if kind == 'fp32':
            path = ROOT / ('models/pp-detection/picodet-l-320-fp32.onnx' if name=='picodet' else '.tmp/phase2/ppyoloe-plus-s-candidate.onnx')
        elif kind == 'w8a32':
            path = ROOT / f'.tmp/w8a32-artifacts/2026-09-12/{name}/{name}-w8a32.onnx'
        else:
            path = CACHE / f'{name}-{kind}.onnx'
        source = next(s for s in variant['sources'] if s['kind']=='modelscope')
        if not path.exists():
            print('获取固定资产', name, kind, flush=True)
            with urllib.request.urlopen(source['downloadUrl'], timeout=60) as response:
                content = response.read()
            assert len(content)==variant['bytes'] and hashlib.sha256(content).hexdigest()==variant['sha256']
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        assert path.stat().st_size == variant['bytes'], str(path)
        assert sha(path) == variant['sha256'], str(path)
        models.append(dict(name=name, variant=kind, precision=variant['precision'], path=str(path), manifest=str(manifest_path), manifestSha256=sha(manifest_path), bytes=variant['bytes'], sha256=variant['sha256'], source=source))
        print('资产校验通过', name, kind, flush=True)

annotations = ROOT / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
image_root = ROOT / '.tmp/phase2/dataset/images'
dataset = json.loads(annotations.read_text(encoding='utf-8'))
lock = json.loads((annotations.parent/'images.lock.json').read_text(encoding='utf-8'))
images = []
for image in dataset['images']:
    evidence = next(x for x in lock if x['imageId']==image['id'])
    path = image_root / image['file_name']
    assert sha(path)==evidence['sha256'] and path.stat().st_size==evidence['bytes']
    images.append(dict(**image, sha256=evidence['sha256']))
noncrowd = [a for a in dataset['annotations'] if not a.get('iscrowd')]
inputs = dict(preparedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), sdkCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(), sdkRoot=str(ROOT), sdkVersion='0.3.2', sdkBundle=str(ROOT/'packages/sdk/dist/browser-global.js'), sdkSha256=sha(ROOT/'packages/sdk/dist/browser-global.js'), protocolSha256=sha(OUT/'protocol.md'), annotations=str(annotations), annotationsSha256=sha(annotations), imageRoot=str(image_root), images=images, models=models, nonCrowd=len(noncrowd), small=sum(a['area']<1024 for a in noncrowd), outputs=str(OUT/'browser'))
(OUT/'inputs.json').write_text(json.dumps(inputs,ensure_ascii=False,indent=2),encoding='utf-8')
print('准备完成', len(models), '模型',len(images),'图片',inputs['small'],'小目标',flush=True)
