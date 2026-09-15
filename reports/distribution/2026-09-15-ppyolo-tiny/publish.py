"""Tiny FP32 分阶段发布；默认只准备本地材料，远程写入必须显式选择阶段。"""
from __future__ import annotations
import argparse
import copy
import gzip
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent
STAGE = ROOT / '.tmp/tiny-release/publication'
QUALITY = ROOT / 'reports/evaluation/2026-09-15-2d-candidates'
MODEL = ROOT / '.tmp/candidate-2d-20260915/ppyolo-tiny-320-fp32.onnx'
PRODUCT = ROOT / 'models/ppyolo-tiny-320/0.1.0'
PREFIX = 'ppyolo-tiny-320/0.1.0/'
FILENAME = 'ppyolo-tiny-320-fp32.onnx'
SHA = '1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653'
BYTES = 4511117
PREVIOUS_SHA = '9b505ca82f52990e31389e52bf6233bcb822478a85360be91a47bf625b8e25d2'
REPOSITORY = 'chenmohan/web-sdk-pp-detection'
SOURCES = ('modelscope', 'huggingface')
PHASE_PYTHON = Path('F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe')
CACHE = PHASE_PYTHON.parents[2]


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    return sha(path.read_bytes())


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    temporary.replace(path)


def identity(path):
    return {'bytes': path.stat().st_size, 'sha256': digest(path)}


def now():
    return datetime.now(timezone.utc).isoformat()


def gunzip(name):
    return json.loads(gzip.decompress((QUALITY / name).read_bytes()))


def evidence_files():
    paths = list(QUALITY.rglob('*'))
    paths += list((ROOT / 'tools/model-pipeline/evaluation').glob('*.py'))
    paths += [ROOT / 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json',
              ROOT / 'packages/sdk/dist/browser-global.js', ROOT / 'packages/sdk/dist/inference.worker.js']
    paths += [ROOT / f'models/pp-detection/picodet-{key}-320/1.0.1/manifest.json' for key in ('xs', 's')]
    return {str(p.relative_to(ROOT)).replace('\\', '/'): identity(p) for p in sorted(paths)
            if p.is_file() and '__pycache__' not in p.parts}


def input_files():
    """验证真实图集及建模源码，避免仅锁定证据中的自述摘要。"""
    locked = {}
    images = gunzip('evidence/round-1/tiny-wasm.json.gz')['images']
    require(len(images) == 64 and len({x['imageId'] for x in images}) == 64, '真实图集数量错误')
    for image in images:
        path = CACHE / 'dataset/images' / image['fileName']
        require(digest(path) == image['sha256'], '真实图像摘要错误：' + image['fileName'])
        locked[str(path)] = identity(path)
    lock = load(QUALITY / 'sources.lock.json')
    upstream = CACHE / 'upstream' / ('PaddleDetection-' + lock['upstreamRevision'])
    for item in lock['files']:
        path = upstream / item['path']
        require(identity(path) == {k: item[k] for k in ('bytes', 'sha256')}, '上游固定源码摘要错误：' + item['path'])
        locked[str(path)] = identity(path)
    # 所有建模模块均绑定，防止未列入精选来源快照的依赖发生本地修改。
    for path in sorted((upstream / 'ppdet').rglob('*.py')):
        locked[str(path)] = identity(path)
    return locked


def require_quality():
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
    result = subprocess.run([str(PHASE_PYTHON), str(QUALITY / 'reproduction/summarize.py')],
                            cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8')
    require(result.returncode == 0, '归档复算失败：' + result.stderr)
    summary = load(QUALITY / 'summary.json')
    require(summary['sdk'] == '0.4.0' and summary['imageCount'] == 64, '质量协议错误')
    require(digest(ROOT / 'packages/sdk/dist/browser-global.js') == summary['sdkSha256'], '当前SDK与质量证据不符')
    for backend in ('wasm', 'webgpu'):
        rows = [x for x in summary['rows'] if x['model'] == 'tiny' and x['backend'] == backend]
        require(len(rows) == 1, '缺少或重复Tiny后端结果')
        row = rows[0]
        require(row['sha256'] == SHA and row['bytes'] == BYTES, '质量模型身份错误')
        require(len(row['rounds']) == 3 and {x['round'] for x in row['rounds']} == {1, 2, 3}, '质量轮次缺失或重复')
    life = gunzip('evidence/lifecycle.json.gz')
    require(life['modelSha256'] == SHA and life['sdkSha256'] == summary['sdkSha256'], '生命周期身份错误')
    require(len(life['rows']) == 4 and {(r['backend'], r['executionMode']) for r in life['rows']} ==
            set(itertools.product(('wasm', 'webgpu'), ('main', 'worker'))), '生命周期组合缺失或重复')
    for row in life['rows']:
        require(row['status'] == 'passed' and len(row['results']) == 2, '生命周期结果缺失')
        for detection in row['results']:
            require(detection['runtime']['backend'] == row['backend'] and
                    detection['runtime']['mode'] == row['executionMode'] and detection['runtime']['fallbacks'] == [], '生命周期运行时不符')
    return summary, result.stdout


def parameter_count():
    # 用固定上游模型定义统计可训练Parameter，不把BN状态或ONNX常量算作参数。
    lock = load(QUALITY / 'sources.lock.json')
    upstream = CACHE / 'upstream' / ('PaddleDetection-' + lock['upstreamRevision'])
    code = """import sys,json,math
sys.path.insert(0,sys.argv[1])
from ppdet.core.workspace import load_config,create
c=load_config(sys.argv[1]+'/configs/ppyolo/ppyolo_tiny_650e_coco.yml')
m=create(c.architecture)
p=list(m.parameters())
print('参数统计='+json.dumps({'parameters':len(p),'allParameterElements':sum(math.prod(x.shape) for x in p),'trainableParameterElements':sum(math.prod(x.shape) for x in p if not x.stop_gradient)}))
"""
    run = subprocess.run([str(PHASE_PYTHON), '-c', code, str(upstream)], cwd=ROOT,
                         env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}, capture_output=True, text=True, encoding='utf-8')
    require(run.returncode == 0, 'Paddle参数复算失败：' + run.stderr)
    value = json.loads(next(x.split('=', 1)[1] for x in run.stdout.splitlines() if x.startswith('参数统计=')))
    require(value == {'parameters': 358, 'allParameterElements': 1102131, 'trainableParameterElements': 1086147}, '参数统计改变')
    return value


def files(phase):
    folder = STAGE / phase
    return sorted([{'path': p.relative_to(folder).as_posix(), **identity(p)} for p in folder.rglob('*') if p.is_file()], key=lambda x: x['path'])


def prepare():
    require(identity(MODEL) == {'bytes': BYTES, 'sha256': SHA}, '本地权重大小或摘要错误')
    require(not any((REPORT / f'{p}-uploads.json').exists() for p in ('weights', 'metadata')), '已有上传记录，禁止重新准备覆盖协议')
    summary, recompute = require_quality()
    inputs = input_files()
    parameters = parameter_count()
    lock = load(QUALITY / 'sources.lock.json')
    license_entry = next(x for x in lock['files'] if x['path'] == 'LICENSE')
    license_bytes = gzip.decompress((QUALITY / license_entry['snapshot']).read_bytes())
    require({'bytes': len(license_bytes), 'sha256': sha(license_bytes)} ==
            {k: license_entry[k] for k in ('bytes', 'sha256')}, '上游许可摘要错误')
    preparation = load(QUALITY / 'preparation.json')
    config = next(x for x in lock['files'] if x['path'] == 'configs/ppyolo/ppyolo_tiny_650e_coco.yml')
    card = f'''# PP-YOLO Tiny 320 FP32（0.1.0）

本镜像由 chenmohan 转换维护，并非 PaddleDetection 官方账号。上游代码和权重按 Apache-2.0 分发，完整原文见 LICENSE。

固定上游提交：`{lock['upstreamRevision']}`。
配置：{config['url']}
权重：{lock['weights']['url']}
原权重 SHA-256：`{lock['weights']['sha256']}`。

最终 ONNX：{BYTES:,} 字节；SHA-256 `{SHA}`；实际 opset 14。
Paddle可训练参数为 1,086,147；358个Parameter共1,102,131元素，排除stop_gradient状态后统计。不用ONNX initializer估算参数。

Paddle2ONNX 1.3.1 导出，原始ONNX SHA-256 `{preparation['sourceSha256']}`。
修正NMS的 Squeeze.7/Squeeze.9 为 axes=[0,2]，保留单检测框轴；固定batch=1、im_shape=[[320,320]]、scale_factor=[[1,1]]，不更改权重。完整转换记录见 conversion.json。

输入为float32 NCHW 1×3×320×320 RGB，拉伸、bicubic缩放、1/255缩放，再按ImageNet mean=[0.485,0.456,0.406]、std=[0.229,0.224,0.225]归一化，COCO 80类；输出为模型内NMS处理后的检测与计数，SDK执行坐标映射。完整输入、预处理和后处理以同版本manifest为准。

2026-09-15 在 Windows 11 / Chromium 153.0.8010.12、ORT Web 1.27.0、SDK 0.4.0 上验证：固定64张图、716个标注，两后端各三轮及main/Worker四组合生命周期。采用浏览器实际float32输入与Python参考逐框比较，不拿其他模型的AP当作自身FP32通过门槛。
浏览器对ICC图片进行色彩管理，未经ICC处理的Pillow输入可能不同；跨预处理路径结果不能直接归因为后端错误。仅有本批桌面WASM和物理NVIDIA WebGPU证据，不声明手机、NPU或其他浏览器兼容，也不代表全量COCO指标或普遍性能优势。

质量证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-2d-candidates
'''
    PRODUCT.mkdir(parents=True, exist_ok=True)
    conversion = {**preparation, 'status': '固定转换归档', 'upstream': lock['upstreamRevision'],
                  'weights': lock['weights'], 'configuration': config, 'parameters': parameters}
    dump(PRODUCT / 'conversion.json', conversion)
    (PRODUCT / 'README.md').write_text(card, encoding='utf-8', newline='\n')
    (PRODUCT / 'LICENSE').write_bytes(license_bytes)
    folder = STAGE / 'weights' / PREFIX
    folder.mkdir(parents=True, exist_ok=True)
    for name in ('README.md', 'LICENSE', 'conversion.json'):
        (folder / name).write_bytes((PRODUCT / name).read_bytes())
    (folder / FILENAME).write_bytes(MODEL.read_bytes())
    expected = {PREFIX + x for x in (FILENAME, 'README.md', 'LICENSE', 'conversion.json')}
    require({f['path'] for f in files('weights')} == expected, '权重暂存有多余或缺失文件')
    for source in SOURCES:
        previous = ROOT / f'.tmp/tiny-release/{source}-README.previous.md'
        require(identity(previous) == {'bytes': 4021, 'sha256': PREVIOUS_SHA}, '根模型卡前值错误')
    previous = (ROOT / '.tmp/tiny-release/modelscope-README.previous.md').read_text(encoding='utf-8')
    card_root = previous.replace('| PP-YOLOE+ X 640 |', '| PP-YOLO Tiny 320 | ppyolo-tiny-320/0.1.0/manifest.json | FP32 |\n| PP-YOLOE+ X 640 |')
    card_root = card_root.replace('当前共 13 个规格、37 个稳定变体', '该历史批次发布后共 13 个规格、37 个稳定变体')
    card_root += '\n## PP-YOLO Tiny FP32（2026-09-15）\n\n新增 Tiny 320 FP32 0.1.0，当前共14个规格、38个稳定变体。固定上游、许可、NMS转换和ICC输入边界见对应模型卡；本批仅增加桌面WASM/WebGPU证据。SDK/npm仍为0.4.0。\n'
    (REPORT / 'hub-README.md').write_text(card_root, encoding='utf-8', newline='\n')
    (REPORT / 'quality-recompute.log').write_text(recompute, encoding='utf-8')
    protocol = {'date': '2026-09-15', 'model': {'bytes': BYTES, 'sha256': SHA}, 'sources': list(SOURCES),
                'repository': REPOSITORY, 'prefix': PREFIX, 'sdk': '0.4.0', 'sdkSha256': summary['sdkSha256'],
                'qualityGate': '相同浏览器实际输入的Python/ONNX逐框核对，双后端三轮；不比较其他架构作为自身FP32门槛',
                'previousRoot': {'bytes': 4021, 'sha256': PREVIOUS_SHA}}
    dump(REPORT / 'protocol.json', protocol)
    dump(REPORT / 'prepare-receipt.json', {'protocolSha256': digest(REPORT / 'protocol.json'),
         'publisherSha256': digest(Path(__file__)), 'evidence': evidence_files(), 'inputs': inputs, 'parameters': parameters,
         'weightsFiles': files('weights'), 'hubReadme': identity(REPORT / 'hub-README.md')})
    print('真实归档复算、Paddle参数统计、许可核对和本地准备通过；未上传。')


def binding():
    receipt = load(REPORT / 'prepare-receipt.json')
    require(receipt['protocolSha256'] == digest(REPORT / 'protocol.json'), '准备后协议发生变化')
    require(receipt['publisherSha256'] == digest(Path(__file__)), '准备后发布实现发生变化，请重新准备')
    require(receipt['evidence'] == evidence_files(), '准备后原始证据、图集引用或计算脚本发生变化')
    require(receipt['inputs'] == input_files(), '准备后真实图集或上游建模源码发生变化')
    require(receipt['weightsFiles'] == files('weights'), '权重暂存文件集合或摘要变化')
    require(receipt['hubReadme'] == identity(REPORT / 'hub-README.md'), '准备后根模型卡变化')
    for name in ('README.md', 'LICENSE', 'conversion.json'):
        require((PRODUCT / name).read_bytes() == (STAGE / 'weights' / PREFIX / name).read_bytes(), '产品与上传材料不同字节')
    return {'protocolSha256': digest(REPORT / 'protocol.json'), 'receiptSha256': digest(REPORT / 'prepare-receipt.json')}


def expected_files(phase):
    receipt = load(REPORT / 'prepare-receipt.json')
    if phase == 'weights':
        return receipt['weightsFiles']
    items = [{'path': PREFIX + name, **identity(PRODUCT / name)} for name in ('LICENSE', 'README.md', 'conversion.json', 'manifest.json')]
    items.append({'path': 'README.md', **identity(REPORT / 'hub-README.md')})
    return sorted(items, key=lambda x: x['path'])


def uploads(phase, complete=True):
    bound = binding()
    path = REPORT / f'{phase}-uploads.json'
    rows = load(path) if path.exists() else []
    require(len(rows) <= 2 and len({r['source'] for r in rows}) == len(rows), '上传来源重复')
    require({r['source'] for r in rows} <= set(SOURCES), '上传来源未知')
    if complete:
        require(len(rows) == 2, '缺少双源真实上传')
    for row in rows:
        require(re.fullmatch('[a-f0-9]{40}', row['revision']) is not None, '上传revision不是40位提交')
        require(row['phase'] == phase and row['repository'] == REPOSITORY and row['files'] == expected_files(phase), '上传文件集合或身份变化')
        require(all(row[k] == v for k, v in bound.items()), '上传记录与协议/收据不一致')
    return rows


def url(source, revision, path):
    origin = 'https://www.modelscope.cn/models' if source == 'modelscope' else 'https://huggingface.co'
    return f'{origin}/{REPOSITORY}/resolve/{revision}/{path}'


def remote_identity(address):
    import requests
    count, checksum = 0, hashlib.sha256()
    with requests.get(address, stream=True, timeout=(30, 120)) as response:
        response.raise_for_status()
        for chunk in response.iter_content(1024 * 1024):
            count += len(chunk)
            checksum.update(chunk)
    return {'bytes': count, 'sha256': checksum.hexdigest()}


def remote_head(source):
    if source == 'huggingface':
        from huggingface_hub import HfApi
        return HfApi().model_info(REPOSITORY, revision='main').sha
    return subprocess.check_output(['git', '-c', 'http.sslBackend=openssl', 'ls-remote',
            f'https://www.modelscope.cn/{REPOSITORY}.git', 'refs/heads/master'], text=True).split()[0]


def remote_paths(source, revision):
    if source == 'huggingface':
        from huggingface_hub import HfApi
        return set(HfApi().list_repo_files(REPOSITORY, repo_type='model', revision=revision))
    from modelscope.hub.api import HubApi
    return {x['Path'] for x in HubApi().get_model_files(REPOSITORY, revision=revision, recursive=True)}


def upload_folder(source, phase, parent):
    folder = STAGE / phase
    message = f'发布 PP-YOLO Tiny 320 FP32 0.1.0：{phase}'
    if source == 'huggingface':
        from huggingface_hub import HfApi
        return HfApi().upload_folder(repo_id=REPOSITORY, repo_type='model', folder_path=str(folder),
                    commit_message=message, parent_commit=parent, delete_patterns=None).oid
    from modelscope.hub.api import HubApi
    # ModelScope没有parent_commit参数；上传前再次检查HEAD，回读固定提交验证结果。
    require(remote_head(source) == parent, 'ModelScope HEAD并发改变，拒绝上传')
    HubApi().upload_folder(repo_id=REPOSITORY, repo_type='model', folder_path=str(folder),
             commit_message=message, sync_remote_repo=False, max_workers=1, disable_tqdm=True, use_cache=False)
    return remote_head(source)


def validate_downloads(phase):
    state = uploads(phase)
    record = load(REPORT / f'{phase}-downloads.json')
    require(record['uploadsSha256'] == digest(REPORT / f'{phase}-uploads.json'), '回读后上传状态被修改')
    require(record['binding'] == binding(), '回读收据绑定错误')
    expected = {(r['source'], f['path']): (r, f) for r in state for f in r['files']}
    rows = record['results']
    require(len(rows) == len(expected) and {(r['source'], r['path']) for r in rows} == set(expected), '回读组合缺失或重复')
    for row in rows:
        upload, item = expected[row['source'], row['path']]
        require(row['passed'] is True and row['revision'] == upload['revision'] and
                row['url'] == url(upload['source'], upload['revision'], item['path']) and
                all(row[k] == item[k] for k in ('bytes', 'sha256')), '回读记录身份错误')


def verify(phase):
    state = uploads(phase)
    require(files(phase) == expected_files(phase), '回读前暂存文件集合变化')
    rows = []
    for entry in state:
        for item in entry['files']:
            address = url(entry['source'], entry['revision'], item['path'])
            actual = remote_identity(address)
            require(actual == {k: item[k] for k in ('bytes', 'sha256')}, '远程完整GET大小或摘要错误：' + address)
            rows.append({**item, 'source': entry['source'], 'revision': entry['revision'], 'url': address, 'passed': True, 'verifiedAt': now()})
    dump(REPORT / f'{phase}-downloads.json', {'uploadsSha256': digest(REPORT / f'{phase}-uploads.json'),
          'binding': binding(), 'results': rows})
    validate_downloads(phase)
    print(phase + '双源全部文件完整GET回读通过')


def final_manifest():
    validate_downloads('weights')
    template = gunzip('evidence/candidate-manifest.json.gz')
    value = copy.deepcopy(template)
    value['schemaVersion'] = 1
    value['status'] = 'stable'
    value['model'].update({'id': 'ppyolo-tiny-320', 'version': '0.1.0', 'architecture': 'PP-YOLO Tiny',
                           'assets': [{'filename': FILENAME, 'bytes': BYTES, 'sha256': SHA}]})
    variant = copy.deepcopy(template['variants'][0])
    variant.update({'id': 'fp32', 'filename': FILENAME, 'precision': 'fp32', 'quantization': 'none',
                    'status': 'stable', 'sha256': SHA, 'bytes': BYTES, 'parameterCount': 1086147, 'sources': []})
    for row in uploads('weights'):
        variant['sources'].append({'kind': row['source'], 'repository': REPOSITORY, 'revision': row['revision'],
             'path': PREFIX + FILENAME, 'downloadUrl': url(row['source'], row['revision'], PREFIX + FILENAME), 'bytes': BYTES, 'sha256': SHA})
    value.update({'variants': [variant], 'defaultVariant': 'fp32', 'defaultSource': 'modelscope'})
    return value


def manifests():
    dump(PRODUCT / 'manifest.json', final_manifest())
    print('完整runtime清单已绑定双源真实上传及完整GET收据')


def validate_browser():
    require(load(PRODUCT / 'manifest.json') == final_manifest(), '最终清单与已验收来源不符')
    browser = load(REPORT / 'browser.json')
    require(browser['status'] == 'passed' and browser['modelSha256'] == SHA and browser['modelBytes'] == BYTES and
            browser['manifestSha256'] == digest(PRODUCT / 'manifest.json') and
            browser['sdkSha256'] == load(REPORT / 'protocol.json')['sdkSha256'], '浏览器证据身份不符')
    require(browser['protocolSha256'] == binding()['protocolSha256'] and
            browser['receiptSha256'] == binding()['receiptSha256'] and
            browser['workerSha256'] == digest(ROOT / 'packages/sdk/dist/inference.worker.js'), '浏览器协议或Worker身份不符')
    rows = browser['rows']
    require(len(rows) == 8 and {(r['sourceKind'], r['backend'], r['executionMode']) for r in rows} ==
            set(itertools.product(SOURCES, ('wasm', 'webgpu'), ('main', 'worker'))), '浏览器8组合缺失或重复')
    sources = {s['kind']: s for s in load(PRODUCT / 'manifest.json')['variants'][0]['sources']}
    references = {}
    for row in rows:
        require(row['status'] == 'passed' and row['abortCode'] == 'ABORTED' and row['disposedCode'] == 'DISPOSED', '浏览器生命周期未通过')
        require(row['detections'] and row['detections'] == row['recovered'] == row['cached']['detections'], '浏览器恢复或缓存推理不同')
        for result in (row, row['cached']):
            runtime, model = result['runtime'], result['model']
            require(runtime['backend'] == runtime['requestedBackend'] == row['backend'] and
                    runtime['mode'] == row['executionMode'] and runtime['precision'] == 'fp32' and runtime['fallbacks'] == [], '浏览器后端或执行模式错误')
            require(model['id'] == 'ppyolo-tiny-320' and model['version'] == '0.1.0' and model['variantId'] == 'fp32' and model['bytes'] == BYTES and
                    all(model['source'][k] == sources[row['sourceKind']][k] for k in ('kind', 'revision', 'sha256')), '浏览器来源错误')
        for key, source in (('firstLoad', 'network'), ('cachedLoad', 'cache'), ('reloaded', 'network')):
            require(row[key]['modelSource'] == source and isinstance(row[key]['integrityMs'], (int, float)) and row[key]['integrityMs'] >= 0, '浏览器下载/缓存或完整性检查错误')
        for key in ('firstCache', 'reloadedCache'):
            require(row[key] == {'entries': 1, 'bytes': BYTES}, '缓存条目错误')
        for key in ('afterCurrentClear', 'afterAllClear'):
            require(row[key] == {'entries': 0, 'bytes': 0}, '缓存未清理')
        reference = references.setdefault(row['backend'], row['detections'])
        require(reference == row['detections'], '不同来源或main/Worker推理不一致')


def publish(phase):
    bound = binding()
    if phase == 'metadata':
        validate_browser()
        for name in ('manifest.json', 'README.md', 'LICENSE', 'conversion.json'):
            target = STAGE / phase / PREFIX / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((PRODUCT / name).read_bytes())
        (STAGE / phase / 'README.md').write_bytes((REPORT / 'hub-README.md').read_bytes())
    require(files(phase) == expected_files(phase), '上传暂存文件缺失、多余或摘要错误')
    state = uploads(phase, complete=False)
    for source in SOURCES:
        if any(row['source'] == source for row in state):
            continue
        parent = remote_head(source)
        require(re.fullmatch('[a-f0-9]{40}', parent) is not None, '远程HEAD无效')
        existing = {p for p in remote_paths(source, parent) if p.startswith(PREFIX)}
        if phase == 'weights':
            require(not existing, '新版本目录已经存在，禁止覆盖')
        else:
            require(existing == {x['path'] for x in expected_files('weights')}, '版本目录发生并发改变或manifest已经存在')
            for item in expected_files('weights'):
                require(remote_identity(url(source, parent, item['path'])) == {k: item[k] for k in ('bytes', 'sha256')}, '远程权重目录发生改变')
            require(remote_identity(url(source, parent, 'README.md')) == load(REPORT / 'protocol.json')['previousRoot'], '根README前值改变，停止覆盖')
        revision = upload_folder(source, phase, parent)
        require(re.fullmatch('[a-f0-9]{40}', revision) is not None and revision != parent, '上传没有返回新真实提交')
        state.append({'source': source, 'repository': REPOSITORY, 'phase': phase, 'revision': revision,
                      'parentRevision': parent, 'files': expected_files(phase), **bound, 'uploadedAt': now()})
        dump(REPORT / f'{phase}-uploads.json', state)
        print(source, phase, revision)


def validate():
    binding()
    validate_downloads('weights')
    validate_browser()
    validate_downloads('metadata')
    require(files('metadata') == expected_files('metadata'), '元数据暂存发生变化')
    print('发布协议、双源上传及完整GET、最终清单和真实浏览器8组合验证通过')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'weights', 'verify-weights', 'manifests', 'metadata', 'verify-metadata', 'validate'])
    command = parser.parse_args().command
    if command in ('weights', 'metadata'):
        publish(command)
    elif command.startswith('verify-'):
        verify(command[7:])
    else:
        {'prepare': prepare, 'manifests': manifests, 'validate': validate}[command]()


if __name__ == '__main__':
    main()
