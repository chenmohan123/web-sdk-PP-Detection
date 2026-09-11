"""将固定 COCO 图片按 Pillow 11.3.0 解码，供原始像素诊断使用。"""
import json
from pathlib import Path
from PIL import Image

root = Path('.tmp/phase2/dataset')
output = root / 'rgba'
output.mkdir(parents=True, exist_ok=True)
dataset = json.loads((root / 'annotations.json').read_text(encoding='utf-8'))
for image in dataset['images']:
    pixels = Image.open(root / 'images' / image['file_name']).convert('RGBA').tobytes()
    (output / (image['file_name'] + '.rgba')).write_bytes(pixels)
