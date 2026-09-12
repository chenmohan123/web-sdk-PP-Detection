"""用冻结的六类别适配标注评估独立集；不能当官方 VisDrone 排行榜结果。"""
from pathlib import Path
import importlib.util,json,gzip,hashlib,numpy as np
OUT=Path(__file__).resolve().parents[1];OLD=OUT.parent/'2026-09-12-tiling'
spec=importlib.util.spec_from_file_location('first_round',OLD/'reproduction/summarize.py');first=importlib.util.module_from_spec(spec);spec.loader.exec_module(first)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
selection=read(OUT/'selection.json');inputs=read(OUT/'inputs.json');lock=read(OUT/'holdout-lock.json');dataset=read(OUT/'holdout-annotations.json')
assert inputs['selectionSha256']==sha(OUT/'selection.json') and selection['mergeSha256']==sha(OUT/'reproduction/merge.mjs')
assert inputs['holdoutSha256']==sha(OUT/'holdout-lock.json') and inputs['annotationsSha256']==sha(OUT/'holdout-annotations.json')
ids=[i['id'] for i in dataset['images']];rows=[];runs=[];details={}
for backend in ['webgpu','wasm']:
    for name in ['picodet','ppyoloe']:
        for variant in (['fp32','fp16','w8a32'] if backend=='webgpu' else ['fp32']):
            key=f'{name}-{variant}-{backend}';path=OUT/'browser'/f'{key}.json.gz';raw=json.loads(gzip.decompress(path.read_bytes()))
            assert raw['status']=='passed' and not raw['pageErrors'] and raw['selectionSha256']==sha(OUT/'selection.json') and raw['strategy']==selection['chosen']
            assert raw['inputsSha256']==sha(OUT/'inputs.json') and raw['sdkSha256']==inputs['sdkSha256']
            assert [i['imageId'] for i in raw['images']]==ids and raw['imageCount']==32
            runtime=raw['initialization']['runtime'];assert runtime['backend']==backend and not runtime['fallbacks']
            model=next(m for m in inputs['models'] if m['name']==name and m['variant']==variant)
            assert raw['initialization']['model']['source']['sha256']==model['sha256'] and raw['initialization']['model']['variantId']==variant
            for script,value in raw['scripts'].items():assert sha(OUT/'reproduction'/script)==value
            runs.append(dict(key=key,file=f'browser/{key}.json.gz',sha256=sha(path),bytes=path.stat().st_size,startedAt=raw['startedAt'],completedAt=raw['completedAt'],adapter=raw['adapter'],browserVersion=raw['browserVersion'],host=raw['host'],initialization=raw['initialization']))
            modes={}
            for mode in ['whole','combined','refined']:
                predictions=[];excluded=0
                for image in raw['images']:
                    for d in image[mode]:
                        category=raw['categoryIds'][d['classId']]
                        if category not in lock['evaluatedCategoryIds']:excluded+=1;continue
                        b=d['box'];predictions.append(dict(image_id=image['imageId'],category_id=category,bbox=[b['x'],b['y'],b['width'],b['height']],score=d['score']))
                metrics=first.evaluate_coco(dataset,predictions,ids)['metrics'];match=first.operating(dataset,predictions,ids);modes[mode]=match
                assert match['totals']['tp']+match['totals']['fn']==lock['nonCrowd']
                row=dict(name=name,variant=variant,backend=backend,mode=mode,metrics=metrics,operating=match['totals'],outOfScopePredictions=excluded,timeMs={k:float(np.percentile([i['modeMs'][mode] for i in raw['images']],p)) for k,p in [('median',50),('p90',90)]});rows.append(row)
                print(key,mode,'AP',round(metrics['AP']*100,2),'小TP',match['totals']['smallTp'],'FP',match['totals']['fp'],flush=True)
            for mode in ['combined','refined']:
                gained=lost=0
                for before,after in zip(modes['whole']['images'],modes[mode]['images']):
                    a=set(before['smallMatchedGtIds']);b=set(after['smallMatchedGtIds']);after['smallGainedGtIds']=sorted(b-a);after['smallLostGtIds']=sorted(a-b)
                    after['lostGtIds']=sorted(set(before['matchedGtIds'])-set(after['matchedGtIds']));gained+=len(b-a);lost+=len(a-b)
                next(r for r in rows if (r['name'],r['variant'],r['backend'],r['mode'])==(name,variant,backend,mode))['change']={'smallGained':gained,'smallLost':lost}
            details[key]=modes
assert len(runs)==8 and len(rows)==24
(OUT/'holdout-summary.json').write_text(json.dumps(dict(strategy=selection['chosen'],selectionSha256=sha(OUT/'selection.json'),datasetSha256=sha(OUT/'holdout-lock.json'),rows=rows,runs=runs),ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'matches-holdout.json.gz').write_bytes(gzip.compress(json.dumps(details,ensure_ascii=False).encode(),mtime=0))
print('8 个独立集组合、24 行结果完成，身份、后端与冻结策略核验通过')
