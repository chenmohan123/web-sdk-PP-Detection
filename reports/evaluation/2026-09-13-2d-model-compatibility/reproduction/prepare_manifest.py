"""生成本地 SOD 清单及固定 64 图中前 8 张的浏览器 smoke 子集。"""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / 'tools/model-pipeline'))
from ppyoloe.build_manifest import build_runtime_manifest

work = root / '.tmp/sod-20260913'
data = json.loads((root / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text(encoding='utf-8'))
manifest = build_runtime_manifest(work / 'ppyoloe-sod-l-640-candidate.onnx', data, download_url='http://localhost/ppyoloe-sod-l-640-candidate.onnx')
manifest['model'] = {'id': 'ppyoloe-sod-l-640-coco', 'version': 'b25522a0-labs.1'}
manifest['variants'][0]['id'] = 'sod-l-fp32'
(work / 'candidate-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
data['images'] = data['images'][:8]
ids = {image['id'] for image in data['images']}
data['annotations'] = [annotation for annotation in data['annotations'] if annotation['image_id'] in ids]
(work / 'browser-annotations.json').write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
print('已生成仅用于本地实验的清单与 8 图子集')
