"""发布 M/L/X 六个精度变体；复用宿主登录并固定实际 Hub 提交，不处理令牌。"""
from __future__ import annotations
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

if not __debug__:
    raise SystemExit('发布校验禁止使用 Python 优化模式。')

ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent
QUALITY = ROOT/'reports/evaluation/2026-09-14-ppyoloe-mlx-release'
JOBS = ROOT/'reports/evaluation/2026-09-14-ppyoloe-mlx-precision/jobs.json'
STAGE = ROOT/'.tmp/precision-mlx-publication-20260914'
REPOSITORY = 'chenmohan/web-sdk-pp-detection'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')


def require_validation():
    protocol_sha = file_sha(QUALITY/'protocol.json')
    quality = read(QUALITY/'summary.json')
    assert quality['protocolSha256'] == protocol_sha
    assert quality['qualityGatePassed'] and quality['browserRunCount'] == 54
    assert len(quality['rows']) == 54 and all(row['qualityGatePassed'] for row in quality['rows'])
    lifecycle = read(REPORT/'desktop-smoke.json')
    assert lifecycle['protocolSha256'] == protocol_sha
    assert lifecycle['sdkSha256'] == quality['sdkSha256']
    expected = {(f'{size}-{precision}', backend, mode)
                for size in ('m', 'l', 'x') for precision in ('fp16', 'w8a32')
                for backend in ('wasm', 'webgpu') for mode in ('main', 'worker')}
    assert len(lifecycle['rows']) == 24
    assert {(row['key'], row['backend'], row['executionMode']) for row in lifecycle['rows']} == expected
    jobs = {f'{job["size"]}-{job["precision"]}': job for job in read(JOBS)}
    for row in lifecycle['rows']:
        job = jobs[row['key']]
        assert row['artifacts']['model'] == {'bytes': job['bytes'], 'sha256': job['sha256']}
        assert row['model']['bytes'] == job['bytes'] and row['model']['precision'] == ('int8' if job['precision'] == 'w8a32' else job['precision'])
        assert len(row['detections']) > 0
        assert row['status'] == 'passed' and row['abortCode'] == 'ABORTED' and row['disposedCode'] == 'DISPOSED'
        assert row['runtime']['backend'] == row['backend'] and row['runtime']['mode'] == row['executionMode']
        assert not row['runtime']['fallbacks'] and row['detections'] == row['recovered']
    return protocol_sha


def prepare():
    jobs = read(JOBS)
    for size in ('m', 'l', 'x'):
        model = f'ppyoloe-plus-{size}-640'
        directory = ROOT/f'models/{model}/0.1.1'
        directory.mkdir(parents=True, exist_ok=True)
        previous = ROOT/f'models/{model}/0.1.0'
        card = (previous/'README.md').read_text(encoding='utf-8')
        card = card.replace(f'PP-YOLOE+ {size.upper()} 640 FP32（0.1.0）', f'PP-YOLOE+ {size.upper()} 640 FP32 / FP16 / W8A32（0.1.1）')
        card = card.replace('- 限制：仅 FP32；', '- 限制：新增精度仅有本轮桌面证据；')
        card = card.replace('reports/distribution/2026-09-14-ppyoloe-smlx', 'reports/distribution/2026-09-14-ppyoloe-mlx-precision')
        card += '\n## 精度变体与发布门槛\n\nFP32 复用已发布 0.1.0 固定来源；新压缩权重位于本版本目录。当前清单默认 FP32、ModelScope，可显式选择 Hugging Face。\n\n'
        card += '| 精度 | 文件 | 字节数 | SHA-256 |\n| --- | --- | ---: | --- |\n'
        for job in [item for item in jobs if item['size'] == size]:
            precision = job['precision']
            filename = f'{model}-{precision}.onnx'
            card += f'| {precision.upper()} | `{filename}` | {job["bytes"]} | `{job["sha256"]}` |\n'
            if precision == 'fp32':
                continue
            path = ROOT/job['model']
            assert path.stat().st_size == job['bytes'] and file_sha(path) == job['sha256']
            folder = STAGE/'weights'/model/'0.1.1'
            folder.mkdir(parents=True, exist_ok=True)
            target = folder/filename
            if not target.exists():
                os.link(path, target)
            assert target.stat().st_size == job['bytes'] and file_sha(target) == job['sha256']
        card += '\nFP16 使用工具 `float16_models.py`，保留敏感算子 FP32；W8A32 使用 `weight_only.py`，权重 INT8、激活及卷积计算 FP32，SDK precision 为 `int8`。固定转换参数和原始转换记录见 SDK 的 `reports/evaluation/2026-09-14-ppyoloe-mlx-precision/`。\n\n'
        card += '六个新增变体按同规格、同后端 FP32 对照：固定 64 图桌面 WASM/WebGPU 三轮，AP 下降不超过 0.5 个百分点，score≥0.5、同类 IoU≥0.5 一对一匹配保留至少 95% FP32 检测。IoU≥0.99 仅诊断坐标偏差；需要贴近 FP32 框坐标时选择 FP32。另验证 main/Worker 预取消、恢复和释放。体积缩小是独立收益，不承诺普遍加速或运行内存同比缩小。\n'
        (directory/'README.md').write_text(card, encoding='utf-8', newline='\n')
        (directory/'LICENSE').write_bytes((previous/'LICENSE').read_bytes())
        for name in ('README.md', 'LICENSE'):
            (STAGE/'weights'/model/'0.1.1'/name).write_bytes((directory/name).read_bytes())
    print('发布文件已准备。', flush=True)


def upload_folder(source, folder, path):
    target_label = path or '模型目录'
    message = f'发布 {target_label} 三精度模型与验证说明'
    if source == 'huggingface':
        from huggingface_hub import HfApi
        result = HfApi().upload_folder(repo_id=REPOSITORY, repo_type='model', folder_path=str(folder), path_in_repo=path, commit_message=message)
        revision = result.oid
    else:
        from modelscope.hub.api import HubApi
        HubApi().upload_folder(repo_id=REPOSITORY, repo_type='model', folder_path=str(folder), path_in_repo=path, commit_message=message, max_workers=1)
        # 上传完成后读取公开分支真实提交；后续所有下载固定该提交并核验完整字节。
        value = subprocess.check_output(['git', '-c', 'http.sslBackend=openssl', 'ls-remote', f'https://www.modelscope.cn/{REPOSITORY}.git', 'refs/heads/master'], text=True)
        revision = value.split()[0]
    assert re.fullmatch(r'[a-f0-9]{40}', revision), 'Hub 必须返回真实提交版本'
    return revision


def publish(phase):
    protocol_sha = require_validation()
    state_path = REPORT/f'{phase}-uploads.json'
    state = read(state_path) if state_path.exists() else []
    for size in ('m', 'l', 'x'):
        model = f'ppyoloe-plus-{size}-640'
        path = f'{model}/0.1.1'
        folder = STAGE/phase/path
        if phase == 'metadata':
            folder.mkdir(parents=True, exist_ok=True)
            for name in ('manifest.json', 'README.md', 'LICENSE'):
                (folder/name).write_bytes((ROOT/'models'/path/name).read_bytes())
        files = [{'path': f'{path}/{item.name}', 'bytes': item.stat().st_size, 'sha256': file_sha(item)} for item in sorted(folder.iterdir()) if item.is_file()]
        assert len(files) == (4 if phase == 'weights' else 3)
        for source in ('modelscope', 'huggingface'):
            existing = [row for row in state if row['size'] == size and row['source'] == source]
            if existing:
                assert len(existing) == 1 and existing[0]['files'] == files and existing[0]['protocolSha256'] == protocol_sha
                print(size, source, phase, '复用已记录提交', flush=True)
                continue
            revision = upload_folder(source, folder, path)
            state.append({'size': size, 'source': source, 'revision': revision, 'files': files,
                          'protocolSha256': protocol_sha, 'uploadedAt': datetime.now(timezone.utc).isoformat()})
            write(state_path, state)
            print(size, source, phase, revision, flush=True)


def manifests():
    require_validation()
    uploads = read(REPORT/'weights-uploads.json')
    assert len(uploads) == 6
    jobs = read(JOBS)
    for size in ('m', 'l', 'x'):
        model = f'ppyoloe-plus-{size}-640'
        manifest = read(ROOT/f'models/{model}/0.1.0/manifest.json')
        manifest['model']['version'] = '0.1.1'
        manifest['limitations'] = [
            'Windows 11 / Chromium 153 / ORT Web 1.27.0 已完成桌面三轮识别与 main/Worker 生命周期验证；新增精度无手机或微信 WebView 实测证据。',
            'FP16 保留敏感算子 FP32；W8A32 为权重 INT8、激活和卷积计算 FP32；体积缩小不等于普遍加速或内存同比下降。',
            '固定 64 图子集按 AP 下降≤0.5 点、score≥0.5、同类 IoU≥0.5 保留≥95% FP32 检测验收；IoU≥0.99 仅坐标诊断，需要贴近 FP32 坐标时使用 FP32。',
            '640×640、batch=1、COCO 80 类轴对齐目标检测；大规格仍有较高的下载、CPU 推理和运行内存开销。']
        for precision in ('fp16', 'w8a32'):
            job = next(item for item in jobs if item['size'] == size and item['precision'] == precision)
            variant = copy.deepcopy(read(ROOT/job['manifest'])['variants'][0])
            variant['filename'] = f'{model}-{precision}.onnx'
            variant['status'] = 'stable'
            variant['sources'] = []
            for source in ('modelscope', 'huggingface'):
                row = next(item for item in uploads if item['size'] == size and item['source'] == source)
                path = f'{model}/0.1.1/{variant["filename"]}'
                assert any(item['path'] == path and item['bytes'] == job['bytes'] and item['sha256'] == job['sha256'] for item in row['files'])
                origin = 'https://modelscope.cn/models' if source == 'modelscope' else 'https://huggingface.co'
                revision = row['revision']
                variant['sources'].append({'kind': source, 'repository': REPOSITORY, 'revision': revision, 'path': path,
                    'downloadUrl': f'{origin}/{REPOSITORY}/resolve/{revision}/{path}', 'bytes': job['bytes'], 'sha256': job['sha256']})
            manifest['variants'].append(variant)
        write(ROOT/f'models/{model}/0.1.1/manifest.json', manifest)
    print('三份 0.1.1 稳定清单已绑定双源真实提交。', flush=True)


def catalog():
    protocol_sha = require_validation()
    folder = STAGE/'catalog'
    folder.mkdir(parents=True, exist_ok=True)
    data = (REPORT/'hub-README.md').read_bytes()
    (folder/'README.md').write_bytes(data)
    files = [{'path': 'README.md', 'bytes': len(data), 'sha256': sha(data)}]
    state_path = REPORT/'catalog-uploads.json'
    state = read(state_path) if state_path.exists() else []
    for source in ('modelscope', 'huggingface'):
        existing = [row for row in state if row['source'] == source]
        if existing:
            assert len(existing) == 1 and existing[0]['files'] == files and existing[0]['protocolSha256'] == protocol_sha
            continue
        revision = upload_folder(source, folder, '')
        state.append({'source': source, 'revision': revision, 'files': files, 'protocolSha256': protocol_sha,
                      'uploadedAt': datetime.now(timezone.utc).isoformat()})
        write(state_path, state)
        print(source, 'catalog', revision, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'weights', 'manifests', 'metadata', 'catalog'])
    args = parser.parse_args()
    if args.phase == 'prepare':
        prepare()
    elif args.phase == 'catalog':
        catalog()
    elif args.phase == 'manifests':
        manifests()
    else:
        publish(args.phase)