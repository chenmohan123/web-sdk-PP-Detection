"""归档固定 64 张图片的 FP16 实验，保留原始预测并汇总各轮冷热耗时。"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd() / 'tools/model-pipeline'))
from evaluation.coco import evaluate_coco
from evaluation.matching import compare_detections


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def percentile(values, q):
    values = sorted(values)
    position = (len(values)-1)*q
    lo = int(position)
    hi = min(lo+1, len(values)-1)
    return values[lo] + (values[hi]-values[lo])*(position-lo)


def timings(report):
    warm = report['images'][1:]
    return {
        'sessionMs': report['loadTimings']['sessionMs'],
        'firstImageMs': report['images'][0]['wallClockMs'],
        'firstInferenceMs': report['images'][0]['timings']['inferenceMs'],
        'warmCount': len(warm),
        **{f'warm{label}{metric}Ms': percentile([row['wallClockMs'] if key == 'wallClockMs' else row['timings'][key] for row in warm], q)
           for label, key in [('Inference','inferenceMs'),('Preprocess','preprocessMs'),('Total','wallClockMs')]
           for metric, q in [('Median',0.5),('P90',0.9)]}
    }


def parity(reference, candidate, image_ids):
    rows=[]
    for image_id in image_ids:
        result=compare_detections([x for x in reference if x['image_id']==image_id], [x for x in candidate if x['image_id']==image_id], iou_threshold=0.5, score_threshold=0.5)
        rows.append({'imageId':image_id, **result})
    totals={key:sum(row[key] for row in rows) for key in ['referenceCount','candidateCount','matchedCount','unmatchedReferenceCount','unmatchedCandidateCount']}
    matches=[match for row in rows for match in row['matches']]
    return {'thresholds':{'score':0.5,'iou':0.5},**totals,'maxScoreDelta':max((m['scoreDelta'] for m in matches), default=None),'maxBboxDeltaPixels':max((m['maxBboxDeltaPixels'] for m in matches), default=None),'images':rows}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir',type=Path,default=Path('.tmp/fp16-2026-09-12'))
    parser.add_argument('--output-dir',type=Path,default=Path('reports/evaluation/2026-09-12-ppyoloe-fp16'))
    args=parser.parse_args();source=args.input_dir;out=args.output_dir;out.mkdir(parents=True,exist_ok=True)
    dataset_path=Path('reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json')
    dataset=read(dataset_path);ids=[im['id'] for im in dataset['images']]
    assert len(ids)==64
    summary={'date':'2026-09-12','scope':'预先固定的 64 张 COCO val2017 子集，非全量 COCO 成绩','annotationCount':len(dataset['annotations']),'annotationsSha256':hashlib.sha256(dataset_path.read_bytes()).hexdigest(),'runs':{}}
    names=['webgpu-fp16','webgpu-fp16-2','webgpu-fp16-3',*[f'webgpu-fp32-{i}' for i in range(1,7)],*[f'webgpu-mixed-{i}' for i in range(1,4)],'wasm-fp16','wasm-mixed','wasm-fp32']
    prediction_evidence={};predictions={};all_metrics={}
    for name in names:
        report=read(source/(name+'.json'))
        assert report['status']=='passed' and len(report['images'])==64
        assert report['artifacts']['annotations']['sha256']==summary['annotationsSha256']
        assert report['artifacts']['imageSetSha256']=='1a36e342e8b8f00a4709d60f9f90d783ec61b179f89d64f041192d350281a99c'
        assert report['runtime']['backend']==report['evaluation']['requestedBackend'] and not report['runtime']['fallbacks']
        preds=report.pop('predictions');predictions[name]=preds
        raw=json.dumps(preds,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        sha=hashlib.sha256(raw).hexdigest()
        if sha not in prediction_evidence:
            zipped=gzip.compress(raw,mtime=0)
            filename=name+'-predictions.json.gz'
            (out/filename).write_bytes(zipped)
            metrics=evaluate_coco(dataset,preds,ids)
            save(out/(name+'-coco.json'),metrics)
            prediction_evidence[sha]={'path':filename,'jsonSha256':sha,'gzipSha256':hashlib.sha256(zipped).hexdigest(),'cocoPath':name+'-coco.json'}
            all_metrics[sha]=metrics
        report['predictionsEvidence']=prediction_evidence[sha]
        report['measurementSummary']=timings(report)
        save(out/(name+'-runtime.json'),report)
        summary['runs'][name]={'capturedAt':report['capturedAt'],'runtimeEvidence':name+'-runtime.json','modelSha256':report['artifacts']['model']['sha256'],'modelBytes':report['artifacts']['model']['bytes'],'metrics':all_metrics[sha]['metrics'],'predictionsEvidence':prediction_evidence[sha],**report['measurementSummary']}
    summary['environment']=report['environment']
    summary['runtimeVersions']=report['runtimeVersions']
    summary['gpuEnvironment']=read(source/'webgpu-mixed-1.json')['environment']['gpu']
    summary['imageSetSha256']=report['artifacts']['imageSetSha256']
    summary['webgpuComparison']={}
    for group,selected in [('fp32',[f'webgpu-fp32-{i}' for i in range(4,7)]),('fp16ReduceMeanFp32',[f'webgpu-mixed-{i}' for i in range(1,4)])]:
        current=[summary['runs'][name] for name in selected]
        summary['webgpuComparison'][group]={'runs':selected,**{key:statistics.median(row[key] for row in current) for key in ['sessionMs','firstImageMs','firstInferenceMs','warmInferenceMedianMs','warmInferenceP90Ms','warmPreprocessMedianMs','warmTotalMedianMs','warmTotalP90Ms']}}
    cpu_reference=json.loads(gzip.decompress(Path('reports/evaluation/2026-09-11-ppyoloe/ppyoloe-pillow-predictions.json.gz').read_bytes()))
    summary['cpu']={}
    for prefix in ['cpu','cpu-mixed']:
        preds=read(source/(prefix+'-predictions.json'))
        runtime=read(source/(prefix+'-runtime.json'))
        filename=prefix+'-predictions.json.gz';(out/filename).write_bytes(gzip.compress(json.dumps(preds,separators=(',',':')).encode(),mtime=0))
        save(out/(prefix+'-runtime.json'),runtime)
        comparison=parity(cpu_reference,preds,ids);save(out/(prefix+'-parity.json'),comparison)
        summary['cpu'][prefix]={'runtimeEvidence':prefix+'-runtime.json','metrics':runtime['evaluation']['metrics'],'parity':{k:v for k,v in comparison.items() if k!='images'}}
    comparison=parity(predictions['webgpu-fp32-4'],predictions['webgpu-mixed-1'],ids)
    save(out/'webgpu-mixed-parity.json',comparison)
    summary['webgpuParity']={k:v for k,v in comparison.items() if k!='images'}
    save(out/'summary.json',summary)
    print(json.dumps({'comparison':summary['webgpuComparison'],'browserAP':{name:summary['runs'][name]['metrics']['AP'] for name in ['webgpu-fp32-4','webgpu-mixed-1','wasm-fp16','wasm-mixed','wasm-fp32']},'parity':summary['webgpuParity'],'cpu':summary['cpu']},ensure_ascii=False))


if __name__=='__main__':
    main()
