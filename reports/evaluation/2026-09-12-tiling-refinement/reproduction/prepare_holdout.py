"""仅按独立集标注与图像元数据选图，不读取任何独立集预测。"""
from pathlib import Path
from PIL import Image
from collections import Counter
import zipfile,io,json,hashlib,datetime
OUT=Path(__file__).resolve().parents[1];ROOT=OUT.parents[2];CACHE=ROOT/'.tmp/tiling-refinement';TARGET=CACHE/'images';TARGET.mkdir(exist_ok=True)
mapping={1:1,2:1,3:2,4:3,5:3,6:8,9:6,10:4};supported=sorted(set(mapping.values()))
def digest(data):return hashlib.sha256(data).hexdigest()
def ioa(a,b):
    inter=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))*max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1]))
    return inter/(a[2]*a[3])
pool=[]
with zipfile.ZipFile(CACHE/'VisDrone2019-DET-val.zip') as archive:
    for file in sorted(n for n in archive.namelist() if '/images/' in n and n.endswith('.jpg')):
        content=archive.read(file);width,height=Image.open(io.BytesIO(content)).size
        annotation=file.replace('/images/','/annotations/').replace('.jpg','.txt');raw=archive.read(annotation);rows=[]
        for line in raw.decode().splitlines():
            values=[float(v) for v in line.strip().rstrip(',').split(',')];assert len(values)>=8
            x,y,w,h,score,category,truncation,occlusion=values[:8]
            assert w>0 and h>0
            rows.append(dict(bbox=[x,y,w,h],score=score,sourceCategory=int(category),truncation=truncation,occlusion=occlusion))
        ignores=[r['bbox'] for r in rows if r['score']==0 or r['sourceCategory'] not in mapping]
        targets=[r for r in rows if r['score']!=0 and r['sourceCategory'] in mapping and not any(ioa(r['bbox'],b)>.5 for b in ignores)]
        small=sum(r['bbox'][2]*r['bbox'][3]<1024 for r in targets);large=sum(r['bbox'][2]*r['bbox'][3]>9216 for r in targets)
        meta=dict(file=file,filename=Path(file).name,annotation=annotation,width=width,height=height,sha256=digest(content),bytes=len(content),annotationSha256=digest(raw),targets=targets,ignores=ignores,small=small,large=large,sequence=Path(file).stem.split('_')[0])
        if max(width,height)>=1280 and small:pool.append(meta)
    pool.sort(key=lambda m:digest(('pp-detection-refinement-holdout-v1:'+m['filename']).encode()))
    selected=[];sequences=Counter()
    for bucket,quota in [('small-and-large',16),('small',16)]:
        choices=[m for m in pool if m not in selected and (bucket=='small' or m['large']>0)]
        taken=0
        for m in choices:
            if sequences[m['sequence']]>=2:continue
            m['bucket']=bucket;selected.append(m);sequences[m['sequence']]+=1;taken+=1
            if taken==quota:break
        if taken<quota:
            for m in choices:
                if m in selected:continue
                m['bucket']=bucket;selected.append(m);sequences[m['sequence']]+=1;taken+=1
                if taken==quota:break
        assert taken==quota,(bucket,taken,len(choices))
    old=json.loads((OUT.parent/'2026-09-12-tiling/inputs.json').read_text());old_hashes={i['sha256'] for i in old['images']}
    categories=json.loads(Path(old['annotations']).read_text())['categories'];dataset=dict(info={'description':'VisDrone val 32 图：COCO 六类别映射与忽略区域适配，非官方 VisDrone 排行榜指标'},images=[],annotations=[],categories=categories)
    lock=[];aid=1
    for index,m in enumerate(selected,1):
        assert m['sha256'] not in old_hashes
        content=archive.read(m['file']);(TARGET/m['filename']).write_bytes(content)
        dataset['images'].append(dict(id=index,file_name=m['filename'],width=m['width'],height=m['height']))
        for r in m['targets']:
            b=r['bbox'];dataset['annotations'].append(dict(id=aid,image_id=index,category_id=mapping[r['sourceCategory']],bbox=b,area=b[2]*b[3],iscrowd=0,sourceCategory=r['sourceCategory']));aid+=1
        for b in m['ignores']:
            for c in supported:dataset['annotations'].append(dict(id=aid,image_id=index,category_id=c,bbox=b,area=b[2]*b[3],iscrowd=1));aid+=1
        lock.append({k:v for k,v in m.items() if k not in ['targets','ignores']}|dict(imageId=index,targetCount=len(m['targets']),ignoreRegionCount=len(m['ignores'])))
    (OUT/'holdout-annotations.json').write_text(json.dumps(dataset,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    evidence=dict(selectedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),seed='pp-detection-refinement-holdout-v1',selection='长边≥1280且存在小目标；16 张同时存在大目标＋16 张其余；每桶优先每序列不超过2张，不足时按同一排序补足',eligibleCount=len(pool),images=lock,sequenceCounts=dict(sequences),mapping=mapping,evaluatedCategoryIds=supported,ignoreRule='score=0、未映射类别、others 作为忽略区；与忽略区 IoA>0.5 的普通GT先排除；每个忽略区对六类建立crowd记录，由COCOeval忽略重叠预测',nonCrowd=sum(not a['iscrowd'] for a in dataset['annotations']),small=sum(not a['iscrowd'] and a['area']<1024 for a in dataset['annotations']),large=sum(not a['iscrowd'] and a['area']>9216 for a in dataset['annotations']),imageRoot=str(TARGET),annotationsSha256=digest((OUT/'holdout-annotations.json').read_bytes()),sourcesSha256=digest((OUT/'sources.json').read_bytes()))
    (OUT/'holdout-lock.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
    print('独立集已锁定',len(lock),'图；普通标注',evidence['nonCrowd'],'小目标',evidence['small'],'大目标',evidence['large'],'不同序列',len(sequences),flush=True)
