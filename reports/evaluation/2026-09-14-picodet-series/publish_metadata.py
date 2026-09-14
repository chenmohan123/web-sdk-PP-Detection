"""追加发布八个 PicoDet 规格的清单、模型卡与许可，不删除远端文件。"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import requests

ROOT=Path(__file__).resolve().parents[3]
REPORT=Path(__file__).resolve().parent
REPOSITORY='chenmohan/web-sdk-pp-detection'


def main():
    quality=json.loads((REPORT/'quality.json').read_bytes())
    lifecycle=json.loads((REPORT/'desktop-smoke.json').read_bytes())
    remote=json.loads((REPORT/'remote-smoke.json').read_bytes())
    if not quality['allPassed'] or len(quality['models'])!=9 or len(lifecycle['rows'])!=36 or len(remote['rows'])!=18:
        raise ValueError('发布证据不完整')
    jobs=[x for x in json.loads((REPORT/'jobs.json').read_bytes()) if x['key']!='picodet-l-320']
    state_path=REPORT/'metadata-uploads.json'
    state=json.loads(state_path.read_bytes()) if state_path.exists() else []
    for source in ('modelscope','huggingface'):
        stage=ROOT/'.tmp/picodet-series-metadata'/source
        stage.mkdir(parents=True,exist_ok=True)
        files=[]
        for job in jobs:
            for filename in ('manifest.json','README.md','LICENSE'):
                original=ROOT/'models/pp-detection'/job['key']/filename
                relative=f'{job["key"]}/1.0.0/{filename}'
                destination=stage/relative
                destination.parent.mkdir(parents=True,exist_ok=True)
                data=original.read_bytes()
                destination.write_bytes(data)
                files.append({'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        previous=next((x for x in state if x['source']==source),None)
        if previous:
            if previous['files']!=files: raise ValueError('已发布的元数据已改变')
            print(source,'复用元数据提交',previous['revision'],flush=True)
            continue
        if source=='huggingface':
            from huggingface_hub import HfApi
            revision=HfApi().upload_folder(repo_id=REPOSITORY,repo_type='model',folder_path=str(stage),commit_message='发布 PicoDet 九规格 FP32 清单与许可',delete_patterns=None).oid
        else:
            from modelscope.hub.api import HubApi
            HubApi().upload_folder(repo_id=REPOSITORY,repo_type='model',folder_path=str(stage),commit_message='发布 PicoDet 九规格 FP32 清单与许可',sync_remote_repo=False,max_workers=1,disable_tqdm=True)
            revision=subprocess.check_output(['git','-c','http.sslBackend=openssl','ls-remote',f'https://www.modelscope.cn/{REPOSITORY}.git','refs/heads/master'],text=True).split()[0]
        state.append({'source':source,'revision':revision,'files':files,'uploadedAt':datetime.now(timezone.utc).isoformat()})
        state_path.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        print(source,'元数据发布',revision,flush=True)
    downloads=[]
    for upload in state:
        host='https://www.modelscope.cn/models' if upload['source']=='modelscope' else 'https://huggingface.co'
        for item in upload['files']:
            url=f'{host}/{REPOSITORY}/resolve/{upload["revision"]}/{item["path"]}'
            response=requests.get(url,timeout=60)
            response.raise_for_status()
            if len(response.content)!=item['bytes'] or hashlib.sha256(response.content).hexdigest()!=item['sha256']:
                raise ValueError(f'远端元数据不符：{item["path"]}')
            downloads.append({'source':upload['source'],'url':url,**item,'status':'passed'})
    (REPORT/'metadata-downloads.json').write_text(json.dumps(downloads,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('48 个远程元数据文件回读通过',flush=True)


if __name__=='__main__':
    main()