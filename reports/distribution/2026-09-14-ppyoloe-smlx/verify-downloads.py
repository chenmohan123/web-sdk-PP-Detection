"""完整读取新增 FP32 权重，核验两平台固定来源；不读取或记录凭据。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import requests

ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent


def verify(item):
    model, source = item
    digest = hashlib.sha256()
    count = 0
    with requests.get(source['downloadUrl'], stream=True, timeout=(30, 90)) as response:
        response.raise_for_status()
        for chunk in response.iter_content(1024 * 1024):
            digest.update(chunk)
            count += len(chunk)
    assert count == source['bytes'], (model, source['kind'], count)
    assert digest.hexdigest() == source['sha256'], (model, source['kind'], 'SHA-256')
    row = dict(model=model, source=source['kind'], url=source['downloadUrl'], revision=source['revision'], bytes=count, sha256=digest.hexdigest(), status='passed', verifiedAt=datetime.now(timezone.utc).isoformat())
    print(model, source['kind'], count, 'passed', flush=True)
    return row


if __name__ == '__main__':
    entries = []
    for size in ['m', 'l', 'x']:
        manifest = json.loads((ROOT/f'models/ppyoloe-plus-{size}-640/0.1.0/manifest.json').read_text(encoding='utf-8'))
        entries.extend((manifest['model']['id'], source) for source in manifest['variants'][0]['sources'])
    with ThreadPoolExecutor(max_workers=3) as executor:
        rows = list(executor.map(verify, entries))
    (REPORT/'downloads.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
