"""仅发布通过本轮三轮质量与生命周期验收的 PicoDet 精度变体。"""
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
import requests
import quality

ROOT, REPORT = quality.ROOT, quality.REPORT
STAGE = ROOT / '.tmp/picodet-series-precision/publication'
REPOSITORY = 'chenmohan/web-sdk-pp-detection'
VERSION = '1.0.1'
read, write, require, sha = quality.read, quality.write, quality.require, quality.sha

def selected():
    receipt = read(REPORT/'quality-receipt.json')
    fixed = {'summary.json', 'artifact-index.json', 'inputs.lock.json', 'jobs.json', 'protocol.json', 'quality.py'}
    expected_evidence = {f'evidence/round-{r}/{quality.stem(j,b)}{suffix}.json.gz' for j in read(REPORT/'jobs.json') for b in quality.BACKENDS for r in (1,2,3) for suffix in ('', '-binding')}
    require(fixed | expected_evidence <= receipt['files'].keys(), '复算收据缺少必需证据')
    for name,digest in receipt['files'].items():
        require(sha((REPORT/name).read_bytes())==digest, '复算后证据发生变化：'+name)
    require(receipt['annotationsSha256']==sha(quality.ANNOTATIONS.read_bytes()), '复算后标注改变')
    for name in ('coco.py','matching.py'):
        require(receipt['evaluationCode'][name]==sha((ROOT/'tools/model-pipeline/evaluation'/name).read_bytes()), '质量计算实现改变')
    summary = read(REPORT/'summary.json')
    lock = read(REPORT/'inputs.lock.json')
    require(summary['protocolSha256'] == lock['protocolSha256'] == sha((REPORT/'protocol.json').read_bytes()), '协议不符')
    require(summary['inputsLockSha256'] == sha((REPORT/'inputs.lock.json').read_bytes()), '锁定输入不符')
    require(summary['sdkSha256'] == lock['sdkSha256'], 'SDK 身份不符')
    jobs = read(REPORT/'jobs.json')
    quality.validate_protocol_jobs(read(REPORT/'protocol.json'),jobs)
    require(lock['jobsSha256']==sha((REPORT/'jobs.json').read_bytes()), '任务清单改变')
    for job in jobs:
        require(lock['models'][f'{job["key"]}-{job["precision"]}']['manifestSha256']==sha((ROOT/job['manifest']).read_bytes()), '质量评测清单改变')
    require(summary['browserRunCount'] == 144 and len(summary['rows']) == 144 and len(summary['candidates']) == 16, '三轮证据不完整')
    required_combinations = {(j['key'],j['precision'],b,r) for j in jobs for b in ('wasm','webgpu') for r in (1,2,3)}
    require({(x['key'],x['precision'],x['backend'],x['round']) for x in summary['rows']} == required_combinations, '组合缺失或重复')
    accepted=[]
    for candidate in summary['candidates']:
        rows = [x for x in summary['rows'] if (x['key'],x['precision']) == (candidate['key'],candidate['precision'])]
        passed=len(rows)==6 and all(x['status']=='passed' and quality.quality_pass(x['apDeltaPoints'],x['retention']['fraction']) for x in rows)
        require(candidate['qualityGatePassed'] == passed, '候选门槛结果矛盾')
        if not passed: continue
        job=next(j for j in jobs if (j['key'],j['precision']) == (candidate['key'],candidate['precision']))
        require((job['bytes'],job['sha256'])==(candidate['bytes'],candidate['sha256']), '候选身份不符')
        for row in rows:
            require(row['artifacts']['model']['sha256']==job['sha256'], '结果模型身份不符')
        accepted.append(job)
    require(len({(x['key'],x['precision']) for x in accepted})==len(accepted), '重复候选')
    return accepted,summary,lock


def validate_downloads(phase):
    uploads=read(REPORT/f'{phase}-uploads.json')
    rows=read(REPORT/f'{phase}-downloads.json')
    require(len(uploads)==2 and {x['source'] for x in uploads}=={'modelscope','huggingface'}, '缺少双来源上传')
    expected={(x['source'],f['path']):(x,f) for x in uploads for f in x['files']}
    require(len(rows)==len(expected) and {(x['source'],x['path']) for x in rows}==expected.keys(), '双源回读组合不完整')
    for row in rows:
        upload,item=expected[row['source'],row['path']]
        origin='https://www.modelscope.cn/models' if row['source']=='modelscope' else 'https://huggingface.co'
        url=f'{origin}/{REPOSITORY}/resolve/{upload["revision"]}/{item["path"]}'
        require(row['status']=='passed' and row['url']==url and row['revision']==upload['revision'] and row['sha256']==item['sha256'] and row['bytes']==item['bytes'], '双源回读身份不符')
        require(sha((STAGE/phase/item['path']).read_bytes())==item['sha256'], '回读后暂存文件改变')


def validate_remote(jobs,summary):
    value=read(REPORT/'remote-smoke.json')
    expected={(f'{j["key"]}-{j["precision"]}',s) for j in jobs for s in ('modelscope','huggingface')}
    require(value['sdkSha256']==summary['sdkSha256'], '双源浏览器SDK不符')
    require(len(value['rows'])==len(expected) and {(x['key'],x['sourceKind']) for x in value['rows']}==expected, '双源浏览器组合不完整')
    by_key={f'{j["key"]}-{j["precision"]}':j for j in jobs}
    for row in value['rows']:
        job=by_key[row['key']]
        manifest=read(ROOT/job['manifest'])
        variant=next(v for v in manifest['variants'] if v['id']==job['precision'])
        source=next(s for s in variant['sources'] if s['kind']==row['sourceKind'])
        require(row['status']=='passed' and row['artifacts']['manifest']['sha256']==sha((ROOT/job['manifest']).read_bytes()), '双源浏览器清单不符')
        require(row['artifacts']['model']=={'bytes':job['bytes'],'sha256':job['sha256']} and row['model']['variantId']==job['precision'] and row['model']['bytes']==job['bytes'], '双源浏览器模型不符')
        require(all(row['model']['source'][k]==source[k] for k in ('kind','revision','sha256')), '双源浏览器来源不符')
        require(row['runtime']['requestedBackend']=='wasm' and row['runtime']['backend']=='wasm' and row['runtime']['mode']=='main' and row['runtime']['precision']==quality.precision(job['precision']) and row['runtime']['fallbacks']==[], '双源浏览器后端或精度不符')
        require(row['detections'] and row['detections']==row['recovered'] and row['abortCode']=='ABORTED' and row['disposedCode']=='DISPOSED', '双源浏览器推理或释放失败')


def validate_published_jobs(jobs, accepted):
    expected=[{**job, 'manifest':f'models/pp-detection/{job["key"]}/{VERSION}/manifest.json'} for job in accepted]
    require(jobs==expected, '最终任务清单与三轮验收身份不一致')

def validate_lifecycle(filename, accepted, summary, lock):
    value=read(REPORT/filename)
    require(value['protocolSha256']==lock['protocolSha256'] and value['sdkSha256']==summary['sdkSha256'], '生命周期身份不符')
    expected={(f'{j["key"]}-{j["precision"]}',b,m) for j in accepted for b in ('wasm','webgpu') for m in ('main','worker')}
    require(len(value['rows'])==len(expected) and {(x['key'],x['backend'],x['executionMode']) for x in value['rows']}==expected, '生命周期组合不完整')
    jobs={f'{x["key"]}-{x["precision"]}':x for x in accepted}
    for row in value['rows']:
        job=jobs[row['key']]
        require(row['status']=='passed' and row['artifacts']['model']=={'bytes':job['bytes'],'sha256':job['sha256']}, '生命周期模型不符')
        require(row['abortCode']=='ABORTED' and row['disposedCode']=='DISPOSED' and row['detections'] and row['detections']==row['recovered'], '取消恢复或释放失败')
        require(row['runtime']['backend']==row['backend'] and row['runtime']['requestedBackend']==row['backend'] and row['runtime']['mode']==row['executionMode'] and row['runtime']['fallbacks']==[], '生命周期后端错误')
        require(row['model']['variantId']==job['precision'] and row['model']['precision']==quality.precision(job['precision']), '生命周期精度错误')
        require(row['artifacts']['manifest']['sha256']==sha((ROOT/job['manifest']).read_bytes()), '生命周期清单变化')

def prepare():
    accepted,summary,lock=selected()
    write(REPORT/'accepted-jobs.json',accepted)
    require(accepted, '没有满足质量门槛的变体')
    for key in sorted({x['key'] for x in accepted}):
        directory=ROOT/'models/pp-detection'/key/VERSION
        directory.mkdir(parents=True,exist_ok=True)
        original=directory.parent
        subset=[j for j in accepted if j['key']==key]
        fp32=next(x for x in read(REPORT/'jobs.json') if x['key']==key and x['precision']=='fp32')
        size=fp32['inputSize']
        card=f'# {key} 精度变体 {VERSION}\n\n'
        card+='上游为 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，权重及本目录 `LICENSE` 使用 Apache-2.0。本项目维护浏览器 ONNX 转换镜像。\n\n'
        card+=f'输入：NCHW `1×3×{size}×{size}` float32，拉伸、bicubic 插值、1/255 缩放及 ImageNet mean/std 归一化；COCO 80 类轴对齐目标检测。\n'
        card+='\n## 本版本精度与验证\n\n默认 FP32、ModelScope，可显式选择 Hugging Face。FP32 沿用 1.0.0 固定权重，新版本仅追加下表通过门槛的精度。\n\n'
        card+='| 精度 | 字节数 | SHA-256 |\n| --- | ---: | --- |\n'
        for job in [fp32,*subset]:
            card+=f'| {job["precision"].upper()} | {job["bytes"]} | `{job["sha256"]}` |\n'
        card+='\n2026-09-15，Windows 11 / Chromium 153 / ORT Web 1.27.0：固定 64 图、716 标注子集，WASM 单线程和物理 NVIDIA WebGPU，各三轮。相对同规格、同后端、同轮 FP32，AP 下降≤0.5个百分点、score≥0.5 且同类 IoU≥0.5 的一对一保留率≥95%；IoU≥0.99仅作坐标诊断。非全量COCO指标，不新增手机或其他浏览器兼容声明。\n\n'
        card+='FP16 保留敏感算子 FP32；W8A32 为权重 INT8、激活与卷积 FP32，SDK precision 参数为 `int8`。文件体积减少是独立收益，不代表普遍加速或内存同比减少。归因与许可沿用上游 Apache-2.0。\n\n'
        card+='转换与逐变体结果：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-picodet-series-precision\n'
        (directory/'README.md').write_text(card,encoding='utf8',newline='\n')
        (directory/'LICENSE').write_bytes((original/'LICENSE').read_bytes())
        folder=STAGE/'weights'/key/VERSION
        folder.mkdir(parents=True,exist_ok=True)
        for job in subset:
            source=ROOT/job['model']; data=source.read_bytes()
            require(len(data)==job['bytes'] and sha(data)==job['sha256'], '本地权重变动')
            target=folder/source.name
            if not target.exists(): os.link(source,target)
            require(sha(target.read_bytes())==job['sha256'], '暂存权重不符')
        for name in ('README.md','LICENSE'): (folder/name).write_bytes((directory/name).read_bytes())
    print(f'已准备 {len(accepted)} 个通过质量门槛的变体；等待生命周期验证。',flush=True)

def publish(phase):
    accepted,summary,lock=selected()
    if phase=='metadata':
        final_jobs=read(REPORT/'published-jobs.json')
        validate_published_jobs(final_jobs,accepted)
        validate_lifecycle('lifecycle-published.json',final_jobs,summary,lock)
        validate_downloads('weights')
        validate_remote(final_jobs,summary)
    else: validate_lifecycle('lifecycle-candidates.json',accepted,summary,lock)
    state_path=REPORT/f'{phase}-uploads.json'
    state=read(state_path) if state_path.exists() else []
    folder=STAGE/phase
    if phase=='metadata':
        folder.mkdir(parents=True,exist_ok=True)
        (folder/'README.md').write_bytes((REPORT/'hub-README.md').read_bytes())
        for key in sorted({x['key'] for x in accepted}):
            for name in ('manifest.json','README.md','LICENSE'):
                target=folder/key/VERSION/name; target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes((ROOT/'models/pp-detection'/key/VERSION/name).read_bytes())
    files=[{'path':x.relative_to(folder).as_posix(),'bytes':x.stat().st_size,'sha256':sha(x.read_bytes())} for x in sorted(folder.rglob('*')) if x.is_file()]
    expected_files={}
    for key in {x['key'] for x in accepted}:
        for name in (('README.md','LICENSE') if phase=='weights' else ('manifest.json','README.md','LICENSE')):
            data=(ROOT/'models/pp-detection'/key/VERSION/name).read_bytes()
            expected_files[f'{key}/{VERSION}/{name}']={'bytes':len(data),'sha256':sha(data)}
    if phase=='weights':
        for job in accepted:
            expected_files[f'{job["key"]}/{VERSION}/{Path(job["model"]).name}']={'bytes':job['bytes'],'sha256':job['sha256']}
    else:
        data=(REPORT/'hub-README.md').read_bytes()
        expected_files['README.md']={'bytes':len(data),'sha256':sha(data)}
    require({x['path']:{k:x[k] for k in ('bytes','sha256')} for x in files}==expected_files, '暂存文件不完整、多余或与验收内容不符')
    for source in ('modelscope','huggingface'):
        prior=next((x for x in state if x['source']==source),None)
        if prior:
            require(prior['files']==files and prior['protocolSha256']==lock['protocolSha256'], '已记录发布发生变化')
            print(source,phase,'复用记录',flush=True); continue
        message=f'发布 PicoDet 全系列已验收精度变体 {phase}'
        if phase=='metadata':
            origin='https://www.modelscope.cn/models' if source=='modelscope' else 'https://huggingface.co'
            branch='master' if source=='modelscope' else 'main'
            response=requests.get(f'{origin}/{REPOSITORY}/resolve/{branch}/README.md',timeout=(30,90))
            response.raise_for_status()
            require(response.content in ((REPORT/'hub-README.previous.md').read_bytes(),(REPORT/'hub-README.md').read_bytes()), '远程根模型卡已被其他工作修改，停止覆盖')
        if source=='huggingface':
            from huggingface_hub import HfApi
            revision=HfApi().upload_folder(repo_id=REPOSITORY,repo_type='model',folder_path=str(folder),commit_message=message,delete_patterns=None).oid
        else:
            from modelscope.hub.api import HubApi
            HubApi().upload_folder(repo_id=REPOSITORY,repo_type='model',folder_path=str(folder),commit_message=message,sync_remote_repo=False,max_workers=1,disable_tqdm=True)
            revision=subprocess.check_output(['git','-c','http.sslBackend=openssl','ls-remote',f'https://www.modelscope.cn/{REPOSITORY}.git','refs/heads/master'],text=True).split()[0]
        require(re.fullmatch('[a-f0-9]{40}',revision), 'Hub 没有返回真实提交')
        state.append({'source':source,'phase':phase,'revision':revision,'files':files,'protocolSha256':lock['protocolSha256'],'uploadedAt':datetime.now(timezone.utc).isoformat()})
        write(state_path,state)
        print(source,phase,revision,flush=True)

def manifests():
    accepted,summary,lock=selected()
    uploads=read(REPORT/'weights-uploads.json')
    require(len(uploads)==2 and {x['source'] for x in uploads}=={'modelscope','huggingface'}, '双源权重未齐')
    final=[]
    for key in sorted({x['key'] for x in accepted}):
        m=read(ROOT/'models/pp-detection'/key/'manifest.json')
        m['model']['version']=VERSION
        m['limitations']=['2026-09-15 桌面 Windows 11 / Chromium 153 / WASM 与 NVIDIA WebGPU 三轮固定 64 图验证；非全量 COCO，未新增手机或其他浏览器声明。',
          'FP16 保留敏感算子 FP32；W8A32 权重 INT8、激活和卷积 FP32。体积减少不等于普遍加速或内存同比下降。',
          '只提供通过 AP 下降≤0.5点和检测保留率≥95% 门槛的精度；需要贴近原始坐标时选择 FP32。']
        for job in [x for x in accepted if x['key']==key]:
            v=copy.deepcopy(next(x for x in read(ROOT/job['manifest'])['variants'] if x['id']==job['precision']))
            v['status']='stable'; v['sources']=[]
            for source in ('modelscope','huggingface'):
                upload=next(x for x in uploads if x['source']==source)
                path=f'{key}/{VERSION}/{v["filename"]}'
                require(any(x['path']==path and x['sha256']==job['sha256'] and x['bytes']==job['bytes'] for x in upload['files']), '远程权重记录缺失')
                origin='https://www.modelscope.cn/models' if source=='modelscope' else 'https://huggingface.co'
                v['sources'].append({'kind':source,'repository':REPOSITORY,'revision':upload['revision'],'path':path,'downloadUrl':f'{origin}/{REPOSITORY}/resolve/{upload["revision"]}/{path}','bytes':job['bytes'],'sha256':job['sha256']})
            m['variants'].append(v)
            final.append({**job,'manifest':f'models/pp-detection/{key}/{VERSION}/manifest.json'})
        write(ROOT/'models/pp-detection'/key/VERSION/'manifest.json',m)
    write(REPORT/'published-jobs.json',final)
    print('稳定版本清单已绑定双源真实提交。',flush=True)

def verify(phase):
    uploads=read(REPORT/f'{phase}-uploads.json')
    require(len(uploads)==2, '双源提交不完整')
    rows=[]
    for upload in uploads:
        origin='https://www.modelscope.cn/models' if upload['source']=='modelscope' else 'https://huggingface.co'
        for item in upload['files']:
            url=f'{origin}/{REPOSITORY}/resolve/{upload["revision"]}/{item["path"]}'
            digest=hashlib.sha256(); count=0
            with requests.get(url,stream=True,timeout=(30,90)) as response:
                response.raise_for_status()
                for chunk in response.iter_content(1024*1024): digest.update(chunk); count+=len(chunk)
            require(count==item['bytes'] and digest.hexdigest()==item['sha256'], f'远程内容不符：{item["path"]}')
            rows.append({**item,'source':upload['source'],'url':url,'revision':upload['revision'],'status':'passed','verifiedAt':datetime.now(timezone.utc).isoformat()})
            print(upload['source'],item['path'],'回读通过',flush=True)
    write(REPORT/f'{phase}-downloads.json',rows)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['prepare','weights','manifests','metadata','verify-weights','verify-metadata'])
    phase=parser.parse_args().phase
    if phase=='prepare': prepare()
    elif phase=='manifests': manifests()
    elif phase.startswith('verify-'): verify(phase[7:])
    else: publish(phase)
