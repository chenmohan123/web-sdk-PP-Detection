"""检查强切片真阳性是否被弱整图框压制；仅用已有 COCO 开发集。"""
from pathlib import Path
import json,gzip,importlib.util
OUT=Path(__file__).resolve().parents[1];ROOT=OUT.parents[2];OLD=OUT.parent/'2026-09-12-tiling'
spec=importlib.util.spec_from_file_location('first',OLD/'reproduction/summarize.py');first=importlib.util.module_from_spec(spec);spec.loader.exec_module(first)
dataset=json.loads((ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text());evidence=[]
def box(d):b=d['box'];return [b['x'],b['y'],b['width'],b['height']]
for name in ['picodet','ppyoloe']:
    run=json.loads(gzip.decompress((OLD/'browser'/f'{name}-fp32-webgpu.json.gz').read_bytes()));matches=[]
    for image in run['images']:
        gt=[a for a in dataset['annotations'] if a['image_id']==image['imageId'] and not a.get('iscrowd') and a['area']<1024]
        for ti,tile in enumerate(image['tiles']):
            for di,d in enumerate(tile['projected']):
                if d['score']<.5:continue
                blockers=[w for w in image['whole'] if w['classId']==d['classId'] and first.overlap(box(w),box(d))>.5]
                if not blockers or any(w['score']>=.5 for w in blockers):continue
                matched=[a['id'] for a in gt if a['category_id']==run['categoryIds'][d['classId']] and first.overlap(a['bbox'],box(d))>=.5]
                if matched:matches.append(dict(imageId=image['imageId'],tileIndex=ti,detectionIndex=di,score=d['score'],blockingScores=[w['score'] for w in blockers],smallGtIds=matched))
    evidence.append(dict(name=name,candidateCount=len(matches),distinctSmallGtCount=len({gid for m in matches for gid in m['smallGtIds']}),examples=matches))
    print(name,'可匹配小目标的强切片框',len(matches),'涉及 GT',evidence[-1]['distinctSmallGtCount'],flush=True)
(OUT/'weak-anchor-diagnosis.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
