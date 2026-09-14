"""完整回读新压缩权重或版本元数据，按固定来源校验字节数及 SHA-256。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json
import requests

ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(item):
    digest = hashlib.sha256()
    count = 0
    with requests.get(item['url'], stream=True, timeout=(30, 90)) as response:
        response.raise_for_status()
        for chunk in response.iter_content(1024 * 1024):
            digest.update(chunk)
            count += len(chunk)
    require(count == item['bytes'], f'{item["id"]}/{item["source"]} 字节数不符')
    require(digest.hexdigest() == item['sha256'], f'{item["id"]}/{item["source"]} SHA-256 不符')
    row = {**item, 'status': 'passed', 'verifiedAt': datetime.now(timezone.utc).isoformat()}
    print(item['id'], item['source'], count, 'passed', flush=True)
    return row


def entries(kind):
    rows = []
    if kind == 'weights':
        for size in ('m', 'l', 'x'):
            model = f'ppyoloe-plus-{size}-640'
            manifest = json.loads((ROOT/f'models/{model}/0.1.1/manifest.json').read_bytes())
            for variant in manifest['variants']:
                if variant['id'] == 'fp32':
                    continue
                require(variant['status'] == 'stable', f'{model}/{variant["id"]} 未声明稳定')
                require({item['kind'] for item in variant['sources']} == {'modelscope', 'huggingface'}, '来源集合不符')
                for source in variant['sources']:
                    require(source['bytes'] == variant['bytes'] and source['sha256'] == variant['sha256'], '来源摘要不符')
                    rows.append({'id': f'{model}/{variant["id"]}', 'source': source['kind'], 'url': source['downloadUrl'],
                                 'revision': source['revision'], 'bytes': source['bytes'], 'sha256': source['sha256']})
        require(len(rows) == 12 and len({(row['id'], row['source']) for row in rows}) == 12, '必须有十二个唯一权重来源')
    else:
        uploads = json.loads((REPORT/f'{kind}-uploads.json').read_bytes())
        require(len(uploads) == (2 if kind == 'catalog' else 6), '元数据提交数量不符')
        for upload in uploads:
            source = upload['source']
            require(source in ('modelscope', 'huggingface'), '来源类型无效')
            origin = 'https://modelscope.cn/models' if source == 'modelscope' else 'https://huggingface.co'
            for item in upload['files']:
                require(item['path'].endswith(('manifest.json', 'README.md', 'LICENSE')), '元数据文件类型无效')
                local = REPORT/'hub-README.md' if kind == 'catalog' else ROOT/'models'/item['path']
                require(len(local.read_bytes()) == item['bytes'] and hashlib.sha256(local.read_bytes()).hexdigest() == item['sha256'], '本地元数据发生变化')
                rows.append({'id': item['path'], 'source': source, 'url': f'{origin}/chenmohan/web-sdk-pp-detection/resolve/{upload["revision"]}/{item["path"]}',
                             'revision': upload['revision'], 'bytes': item['bytes'], 'sha256': item['sha256']})
        expected = 2 if kind == 'catalog' else 18
        require(len(rows) == expected and len({(row['id'], row['source']) for row in rows}) == expected, '唯一元数据来源数量不符')
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['weights', 'metadata', 'catalog'], default='weights', nargs='?')
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=3) as executor:
        rows = list(executor.map(verify, entries(args.kind)))
    filename = 'downloads.json' if args.kind == 'weights' else f'{args.kind}-downloads.json'
    (REPORT/filename).write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')