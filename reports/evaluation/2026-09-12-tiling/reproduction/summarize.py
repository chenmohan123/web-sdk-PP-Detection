"""一次性实验：用官方 COCOeval 汇总精度、匹配和每图耗时。"""
from pathlib import Path
from contextlib import redirect_stdout
from collections import defaultdict
import copy, datetime, gzip, hashlib, io, json, sys
import importlib.metadata
import numpy as np
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation import evaluate_coco

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf-8'))
def overlap(a,b):
    inter=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))*max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1]))
    union=a[2]*a[3]+b[2]*b[3]-inter
    return inter/union if union>0 else 0

def operating(dataset,predictions,image_ids):
    """固定阈值的同类一对一匹配；crowd 检测交由官方实现忽略。"""
    predictions=[p for p in predictions if p['score']>=.5]
    with redirect_stdout(io.StringIO()):
        gt=COCO();gt.dataset=copy.deepcopy(dataset);gt.dataset.setdefault('info',{});gt.createIndex()
        if predictions: dt=gt.loadRes(copy.deepcopy(predictions))
        else:
            dt=COCO();dt.dataset={'images':dataset['images'],'categories':dataset['categories'],'annotations':[]};dt.createIndex()
        evaluator=COCOeval(gt,dt,'bbox');evaluator.params.imgIds=image_ids
        evaluator.params.iouThrs=np.array([.5]);evaluator.params.areaRng=[[0,1e10]];evaluator.params.areaRngLbl=['all']
        evaluator.evaluate()
    per_image={i:dict(imageId=i,tp=0,fp=0,fn=0,ignored=0,duplicateFp=0,matchedGtIds=[],missedGtIds=[],detections=[]) for i in image_ids}
    for e in evaluator.evalImgs:
        if e is None: continue
        row=per_image[e['image_id']]
        matched=set()
        for gid,match,ignored in zip(e['gtIds'],e['gtMatches'][0],e['gtIgnore']):
            if ignored:continue
            if match: row['matchedGtIds'].append(int(gid));matched.add(int(gid))
            else:row['missedGtIds'].append(int(gid));row['fn']+=1
        for did,match,ignored in zip(e['dtIds'],e['dtMatches'][0],e['dtIgnore'][0]):
            p=dt.anns[int(did)]
            status='ignored' if ignored else ('tp' if match else 'fp')
            row[status]+=1
            duplicate=status=='fp' and any(overlap(p['bbox'],gt.anns[gid]['bbox'])>=.5 for gid in matched)
            row['duplicateFp']+=int(duplicate)
            row['detections'].append(dict(categoryId=p['category_id'],bbox=p['bbox'],score=p['score'],status=status,matchedGtId=int(match) if match else None,duplicate=duplicate))
    small={a['id'] for a in dataset['annotations'] if not a.get('iscrowd') and a['area']<1024}
    for row in per_image.values():
        row['matchedGtIds'].sort();row['missedGtIds'].sort()
        row['smallMatchedGtIds']=sorted(small.intersection(row['matchedGtIds']))
    totals={key:sum(r[key] for r in per_image.values()) for key in ['tp','fp','fn','ignored','duplicateFp']}
    totals.update(smallTp=sum(len(r['smallMatchedGtIds']) for r in per_image.values()),smallTotal=len(small))
    totals['precision']=totals['tp']/(totals['tp']+totals['fp']) if totals['tp']+totals['fp'] else 0
    totals['recall']=totals['tp']/(totals['tp']+totals['fn']) if totals['tp']+totals['fn'] else 0
    totals['smallRecall']=totals['smallTp']/len(small)
    return {'totals':totals,'images':list(per_image.values())}

def check_operating():
    # 一个普通目标、一个 crowd、两个同类重复框和一个错误类别框。
    dataset={'images':[{'id':1}],'categories':[{'id':1,'name':'a'},{'id':2,'name':'b'}],'annotations':[
        {'id':1,'image_id':1,'category_id':1,'bbox':[0,0,10,10],'area':100,'iscrowd':0},
        {'id':2,'image_id':1,'category_id':1,'bbox':[50,50,20,20],'area':400,'iscrowd':1}]}
    predictions=[dict(image_id=1,category_id=c,bbox=b,score=s) for c,b,s in [(1,[0,0,10,10],.9),(1,[0,0,10,10],.8),(1,[52,52,5,5],.7),(2,[0,0,10,10],.9)]]
    r=operating(dataset,predictions,[1])['totals']
    assert (r['tp'],r['fp'],r['fn'],r['ignored'],r['duplicateFp'],r['smallTp'])==(1,2,0,1,1,1),r
    empty=operating(dataset,[],[1])['totals'];assert empty['tp']==0 and empty['fn']==1

def main():
    check_operating()
    inputs=read(OUT/'inputs.json');dataset=read(Path(inputs['annotations']))
    assert sha(Path(inputs['annotations']))==inputs['annotationsSha256']
    image_ids=[i['id'] for i in inputs['images']]
    assert not any(a['area']==1024 for a in dataset['annotations']), '需要明确处理 Small 边界'
    summary={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sdkVersion':inputs['sdkVersion'],'imageCount':len(image_ids),'nonCrowd':inputs['nonCrowd'],'small':inputs['small'],'evaluationEnvironment':{'python':sys.version,'packages':{p:importlib.metadata.version(p) for p in ['numpy','Pillow','pycocotools']}},'rows':[],'runs':[]}
    details={}
    for backend in ['webgpu','wasm']:
        for name in ['picodet','ppyoloe']:
            for variant in ['fp32','fp16','w8a32']:
                key=f'{name}-{variant}-{backend}';path=OUT/'browser'/f'{key}.json.gz'
                run=json.loads(gzip.decompress(path.read_bytes()));model=next(x for x in inputs['models'] if x['name']==name and x['variant']==variant)
                assert run['status']=='passed' and run['imageCount']==64 and len(run['images'])==64 and not run['pageErrors'],key
                assert [i['imageId'] for i in run['images']]==image_ids,key
                assert run['model']['sha256']==model['sha256'] and run['sdkSha256']==inputs['sdkSha256'] and run['protocolSha256']==inputs['protocolSha256']
                assert run['inputsSha256']==sha(OUT/'inputs.json')
                identity=run['initialization']['model'];runtime=run['initialization']['runtime']
                assert identity['variantId']==variant and identity['precision']==model['precision'] and identity['source']['sha256']==model['sha256']
                assert runtime['backend']==backend and not runtime['fallbacks'] and runtime['mode']=='main'
                assert run['initialization']['sdkVersion']==inputs['sdkVersion'] and run['ortVersion']=='1.27.0'
                if backend=='webgpu': assert run['adapter']['vendor']=='nvidia' and run['adapter']['isFallbackAdapter'] is False
                summary['runs'].append({k:run[k] for k in ['name','variant','backend','startedAt','completedAt','browserVersion','adapter','host','initialization','scripts']}|{'file':str(path.relative_to(OUT)).replace('\\','/'),'sha256':sha(path),'bytes':path.stat().st_size,'warningCount':sum(run['warnings'].values())})
                modes={}
                for mode,field in [('whole','whole'),('tiles','tiled'),('combined','combined')]:
                    predictions=[]
                    for image in run['images']:
                        assert len(image['tiles'])==4
                        for det in image[field]:
                            box=det['box'];predictions.append(dict(image_id=image['imageId'],category_id=run['categoryIds'][det['classId']],bbox=[box['x'],box['y'],box['width'],box['height']],score=det['score']))
                    metrics=evaluate_coco(dataset,predictions,image_ids)['metrics']
                    matches=operating(dataset,predictions,image_ids);modes[mode]=matches
                    times=[i['modeMs'][mode] for i in run['images']]
                    row=dict(name=name,variant=variant,backend=backend,mode=mode,metrics=metrics,operating=matches['totals'],timeMs={'median':float(np.median(times)),'p90':float(np.percentile(times,90))})
                    summary['rows'].append(row)
                    print(key,mode,'AP',round(metrics['AP']*100,2),'APSmall',round(metrics['APSmall']*100,2),'小目标',matches['totals']['smallTp'],'FP',matches['totals']['fp'],flush=True)
                for mode in ['tiles','combined']:
                    changes=[]
                    for baseline,current in zip(modes['whole']['images'],modes[mode]['images']):
                        assert baseline['imageId']==current['imageId']
                        before=set(baseline['smallMatchedGtIds']);after=set(current['smallMatchedGtIds'])
                        current['smallGainedGtIds']=sorted(after-before);current['smallLostGtIds']=sorted(before-after)
                        current['gainedGtIds']=sorted(set(current['matchedGtIds'])-set(baseline['matchedGtIds']));current['lostGtIds']=sorted(set(baseline['matchedGtIds'])-set(current['matchedGtIds']))
                        changes.append(dict(imageId=current['imageId'],smallGained=len(after-before),smallLost=len(before-after),fpDelta=current['fp']-baseline['fp']))
                    row=next(r for r in summary['rows'] if r['name']==name and r['variant']==variant and r['backend']==backend and r['mode']==mode)
                    row['vsWhole']={'smallGained':sum(c['smallGained'] for c in changes),'smallLost':sum(c['smallLost'] for c in changes),'imagesWithSmallGain':sum(c['smallGained']>0 for c in changes),'imagesWithSmallLoss':sum(c['smallLost']>0 for c in changes),'fpDelta':sum(c['fpDelta'] for c in changes)}
                details[key]=modes
    assert len(summary['rows'])==36 and len(summary['runs'])==12
    for row in summary['rows']:
        t=row['operating'];assert t['tp']+t['fn']==700 and 0<=t['smallTp']<=399
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'matches.json.gz').write_bytes(gzip.compress(json.dumps(details,ensure_ascii=False).encode('utf-8'),mtime=0))
    print('完成 12 个组合、36 组模式汇总；身份、后端、样本和匹配计数校验通过',flush=True)

if __name__=='__main__':
    if '--check' in sys.argv: check_operating();print('通过：同类一对一匹配、重复误检、异类误检、crowd 忽略、空预测')
    else:main()
