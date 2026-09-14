"""复算官方参考、最终候选及浏览器输出的固定 64 图质量指标。"""
from pathlib import Path
from collections import defaultdict
import argparse
import gzip
import hashlib
import json
import sys
import numpy as np
import onnxruntime as ort

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
sys.path.insert(0, str(ROOT / 'tools/model-pipeline'))
from evaluation import evaluate_coco, compare_detections
from picodet.parity import prepare_input


def read(path):
    return json.loads(path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix('.json.gz').read_bytes()))


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def predictions(path, job, annotations, image_root):
    options = ort.SessionOptions()
    options.log_severity_level = 3
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])
    categories = [item['id'] for item in sorted(annotations['categories'], key=lambda x:x['id'])]
    results = []
    for image in annotations['images']:
        data, _ = prepare_input(image_root/image['file_name'], size=(job['inputSize'],job['inputSize']))
        feed = {'image':data}
        if any(item.name == 'scale_factor' for item in session.get_inputs()):
            feed['scale_factor'] = np.ones((1,2),dtype=np.float32)
        values = session.run(None,feed)
        matrix = next(v for v in values if v.ndim == 2 and v.shape[-1] == 6)
        if not np.isfinite(matrix).all():
            raise ValueError('检测输出包含非有限数值')
        for label,score,x1,y1,x2,y2 in matrix:
            if score < .001 or label < 0:
                continue
            sx,sy=image['width']/job['inputSize'],image['height']/job['inputSize']
            x1,x2=[float(np.clip(v*sx,0,image['width'])) for v in (x1,x2)]
            y1,y2=[float(np.clip(v*sy,0,image['height'])) for v in (y1,y2)]
            if x2>x1 and y2>y1:
                results.append({'image_id':image['id'],'category_id':categories[int(label)],'score':float(score),'bbox':[x1,y1,x2-x1,y2-y1]})
    return results


def retained(reference, candidate, image_ids):
    a,b=defaultdict(list),defaultdict(list)
    for row in reference: a[row['image_id']].append(row)
    for row in candidate: b[row['image_id']].append(row)
    matches=[compare_detections(a[i],b[i],iou_threshold=.5,score_threshold=.5) for i in image_ids]
    count=sum(x['referenceCount'] for x in matches)
    kept=sum(x['matchedCount'] for x in matches)
    return {'referenceCount':count,'matchedCount':kept,'fraction':kept/count if count else 1.0}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image-root',type=Path,required=True)
    args=parser.parse_args()
    annotations_path=ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
    annotations=read(annotations_path)
    ids=[x['id'] for x in annotations['images']]
    if len(ids)!=64 or len(set(ids))!=64: raise ValueError('图片数量必须为64')
    out={'protocol':{'maxApLossPoints':.5,'minRetention':.95,'scoreThreshold':.5,'iouThreshold':.5},'annotationsSha256':sha(annotations_path),'models':[]}
    for job in read(REPORT/'jobs.json'):
        key=job['key']
        original=ROOT/job['sourceModel']
        candidate=ROOT/job['model']
        if original.resolve()==candidate.resolve(): raise ValueError('禁止模型自比较')
        if sha(candidate)!=job['sha256']: raise ValueError('候选哈希不符')
        reference=predictions(original,job,annotations,args.image_root)
        converted=predictions(candidate,job,annotations,args.image_root)
        ref_metrics=evaluate_coco(annotations,reference,ids)['metrics']
        rows=[]
        for name,values in [('python-candidate',converted)]+[(b,read(REPORT/f'{key}-{b}.json')['predictions']) for b in ('wasm','webgpu')]:
            metrics=evaluate_coco(annotations,values,ids)['metrics']
            match=retained(reference,values,ids)
            delta=(metrics['AP']-ref_metrics['AP'])*100
            rows.append({'runtime':name,'metrics':metrics,'apDeltaPoints':delta,'retention':match,'passed':delta>=-.5 and match['fraction']>=.95})
        payload={'reference':reference,'candidate':converted}
        archive=REPORT/f'{key}-python-predictions.json.gz'
        archive.write_bytes(gzip.compress(json.dumps(payload,separators=(',',':')).encode(),mtime=0))
        out['models'].append({'key':key,'referenceSha256':sha(original),'candidateSha256':sha(candidate),'referenceMetrics':ref_metrics,'predictions':{'path':archive.name,'sha256':sha(archive)},'runs':rows})
        out['allPassed']=all(row['passed'] for model in out['models'] for row in model['runs'])
        write(REPORT/'quality.json',out)
        print(key,[(x['runtime'],round(x['apDeltaPoints'],4),round(x['retention']['fraction'],4),x['passed']) for x in rows],flush=True)
    if not out['allPassed']: raise SystemExit(1)


if __name__ == '__main__':
    main()