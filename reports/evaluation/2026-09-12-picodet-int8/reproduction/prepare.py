from pathlib import Path
import sys,json,hashlib,urllib.request,time,concurrent.futures
ROOT=Path(r"F:/git/00_chenmohan/github/web-sdk-PP-Detection")
OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation.prepare_subset import select_image_ids,build_subset,build_image_lock,verify_image_lock
raw=(ROOT/'.tmp/phase2/dataset/instances_val2017.json').read_bytes()
full=json.loads(raw)
evaluation=json.loads((ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json').read_text())
eval_ids={x['id'] for x in evaluation['images']}
remaining={**full,'images':[i for i in full['images'] if i['id'] not in eval_ids], 'annotations':[a for a in full['annotations'] if a['image_id'] not in eval_ids]}
selection=select_image_ids(remaining,seed='picodet-int8-calibration-v1',count=128,bucket_size=16)
assert not eval_ids.intersection(selection['imageIds'])
subset=build_subset(full,selection['imageIds'])
cal=OUT/'calibration';cal.mkdir(exist_ok=True)
images=cal/'images';images.mkdir(exist_ok=True)
selection['annotationsSha256']=hashlib.sha256(raw).hexdigest()
selection['excludedEvaluationIds']=sorted(eval_ids)
(cal/'selection.json').write_text(json.dumps(selection,ensure_ascii=False,indent=2),encoding='utf-8')
(cal/'annotations.json').write_text(json.dumps(subset,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'plan.md').write_text('''# PicoDet INT8 可行性实验\n\n已获用户确认；只生成本地 labs 候选、证据和结论。\n\n1. 固定 128 张校准图，排除现有 64 张评测图，保留选择规则与哈希。\n2. 使用稳定清单的 bicubic、除 255、ImageNet 归一化；验证旧校准输入差异。\n3. 从固定 FP32 生成 INT8 Conv 按通道候选，保留所有图转换证据。\n4. 顺序运行 Python CPU、浏览器 WASM/WebGPU 和固定 COCO 子集；性能只同环境比较。\n5. 有效候选与 FP32 交替三轮，分别报告首张、会话、热推理和端到端。\n6. 归档实验报告；不修改稳定模型或线上 Demo，不发布新版本。\n\n质量筛查采用本子集 AP 下降不超过 1 个百分点；该阈值仅作为后续深入评估的筛选标准，不作为稳定发布证明。\n''',encoding='utf-8')
def download(im):
    p=images/im['file_name']
    from PIL import Image
    for attempt in range(4):
        try:
            if not p.exists():
                u='https://s3.amazonaws.com/images.cocodataset.org/val2017/'+im['file_name']
                with urllib.request.urlopen(u,timeout=45) as r: data=r.read()
                p.write_bytes(data)
            with Image.open(p) as image: assert image.size==(im['width'],im['height']); image.verify()
            return im['id']
        except Exception:
            if p.exists(): p.unlink()
            if attempt==3: raise
            time.sleep(1+attempt)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    for i,_ in enumerate(ex.map(download,subset['images']),1):
        if i%16==0: print('校准图片',i,'/128',flush=True)
lock=build_image_lock(full,selection['imageIds'],images);verify_image_lock(images,lock)
(cal/'images.lock.json').write_text(json.dumps(lock,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'calibration':len(lock),'evaluation':len(eval_ids),'overlap':0,'bytes':sum(i['bytes'] for i in lock)}),flush=True)
