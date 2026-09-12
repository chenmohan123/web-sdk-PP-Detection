"""下载公开 VisDrone 验证集与来源说明；只写本次临时目录。"""
from pathlib import Path
import urllib.request,json,hashlib,time
ROOT=Path(__file__).resolve().parents[4];OUT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.tmp/tiling-refinement';CACHE.mkdir(parents=True,exist_ok=True)
sources={
 'dataset-readme.md':'https://raw.githubusercontent.com/VisDrone/VisDrone-Dataset/master/README.md',
 'annotation-readme.md':'https://raw.githubusercontent.com/VisDrone/VisDrone2018-DET-toolkit/master/README.md',
 'mirror.yaml':'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/cfg/datasets/VisDrone.yaml',
 'VisDrone2019-DET-val.zip':'https://github.com/ultralytics/assets/releases/download/v0.0.0/VisDrone2019-DET-val.zip'}
evidence=[]
existing=json.loads((OUT/'sources.json').read_text(encoding='utf-8')) if (OUT/'sources.json').exists() else []
expected={Path(item['file']).name:item for item in existing}
for name,url in sources.items():
    path=CACHE/name
    if not path.exists():
        with urllib.request.urlopen(url,timeout=60) as response,path.with_suffix(path.suffix+'.part').open('wb') as target:
            size=0;last=0
            while chunk:=response.read(1024*1024):
                target.write(chunk);size+=len(chunk)
                if size-last>=32*1024*1024:print(name,round(size/1024**2),'MiB',flush=True);last=size
        path.with_suffix(path.suffix+'.part').replace(path)
    record=dict(file=str(path),url=url,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    if name in expected:assert record['sha256']==expected[name]['sha256'] and record['bytes']==expected[name]['bytes'],f'来源字节与已保存锁不同：{name}'
    evidence.append(record)
    print('已获取',name,path.stat().st_size,flush=True)
(OUT/'sources.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
