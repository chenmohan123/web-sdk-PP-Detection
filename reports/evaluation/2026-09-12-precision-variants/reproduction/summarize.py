from pathlib import Path
import json,statistics,hashlib,gzip
ROOT=Path(r'F:/git/00_chenmohan/github/web-sdk-PP-Detection');OUT=Path(__file__).parent
REPORT=OUT/'report';REPORT.mkdir(exist_ok=True)
sdksha=hashlib.sha256((ROOT/'packages/sdk/dist/browser-global.js').read_bytes()).hexdigest()
summary={'date':'2026-09-12','sdkVersion':'0.3.1','sdkSha256':sdksha,'datasetImages':64,'annotations':716,'models':{},'qualityGate':{'maxApDropPoints':.5,'minMatchedReferenceFraction':.95},'runs':{}}
import sys
sys.path.insert(0,str(ROOT/'tools/model-pipeline'))
from evaluation.matching import compare_detections
rows=[];index=[]
def archive(source,relative):
 raw=source.read_bytes();target=REPORT/relative;target.parent.mkdir(parents=True,exist_ok=True);stored=gzip.compress(raw,mtime=0) if relative.endswith('.gz') else raw;target.write_bytes(stored)
 index.append({'path':relative,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'storedSha256':hashlib.sha256(stored).hexdigest()})
for name in ['picodet','ppyoloe']:
 summary['models'][name]={}
 for kind in ['fp32','fp16','w8a32']:
  manifest=json.loads((OUT/'artifacts'/name/f'{kind}-manifest.json').read_text(encoding='utf-8'));variant=manifest['variants'][0]
  entry={'bytes':variant['bytes'],'sha256':variant['sha256'],'backends':{}}
  for backend in ['wasm','webgpu']:
   runs=[]
   for repeat in [1,2,3]:
    key=f'{name}-{backend}-{kind}-{repeat}';runtime=OUT/'browser'/f'{key}.json';coco=runtime.with_name(key+'-coco.json');r=json.loads(runtime.read_text(encoding='utf-8'));c=json.loads(coco.read_text(encoding='utf-8'))
    assert r['status']=='passed' and len(r['images'])==64 and not r['runtime']['fallbacks']
    assert r['runtime']['backend']==backend and r['runtime']['precision']==variant['precision']
    assert r['artifacts']['sdk']['sha256']==sdksha and r['artifacts']['model']['sha256']==variant['sha256']
    if backend=='webgpu':assert r['environment']['gpu']['physical'] is True
    row={'AP':c['metrics']['AP']*100,'sessionMs':r['loadTimings']['sessionMs'],'firstImageMs':r['performance']['firstImageMs'],'inferenceMs':statistics.median(i['timings']['inferenceMs'] for i in r['images'][1:]),'totalMs':r['performance']['warmRuns']['medianMs'],'p90Ms':r['performance']['warmRuns']['p90Ms']};runs.append(row);summary['runs'][key]=row
    archive(runtime,f'browser/{runtime.name}.gz');archive(coco,f'browser/{coco.name}.gz')
   aggregated={k:statistics.median(row[k] for row in runs) for k in runs[0]};aggregated['APPerRound']=[row['AP'] for row in runs];aggregated.update({k:runs[-1][k] for k in runs[-1] if k!='AP'});aggregated['timingRounds']=[3]
   assert max(aggregated['APPerRound'])-min(aggregated['APPerRound'])<.000001
   if kind!='fp32':
    baseline=summary['models'][name]['fp32']['backends'][backend];assert aggregated['AP']>=baseline['AP']-.5
    l=json.loads((OUT/'browser'/f'{name}-{backend}-fp32-1.json').read_text(encoding='utf-8'))['predictions'];rr=json.loads((OUT/'browser'/f'{name}-{backend}-{kind}-1.json').read_text(encoding='utf-8'))['predictions'];imageids=sorted(set(x['image_id'] for x in l+rr));details=[]
    for imageid in imageids:details.append({'imageId':imageid,**compare_detections([x for x in l if x['image_id']==imageid],[x for x in rr if x['image_id']==imageid],score_threshold=.5,iou_threshold=.5)})
    parity={k:sum(v[k] for v in details) for k in ['referenceCount','candidateCount','matchedCount','unmatchedReferenceCount','unmatchedCandidateCount']};parity.update({k:max(v[k] or 0 for v in details) for k in ['maxScoreDelta','maxBboxDeltaPixels']});parity['matchedReferenceFraction']=parity['matchedCount']/parity['referenceCount']
    assert parity['matchedReferenceFraction']>=.95,(name,kind,backend,parity)
    aggregated['parity']=parity
    target=OUT/f'{name}-{backend}-{kind}-parity.json';target.write_text(json.dumps({'scoreThreshold':.5,'iouThreshold':.5,**parity,'images':details},ensure_ascii=False,indent=2),encoding='utf-8');archive(target,'parity/'+target.name+'.gz')
   entry['backends'][backend]=aggregated
  summary['models'][name][kind]=entry
  sourcebytes=summary['models'][name]['fp32']['bytes'];entry['reductionPercent']=100*(1-entry['bytes']/sourcebytes)
  rows.append(f"| {name} | {kind.upper()} | {entry['bytes']/1e6:.2f} | {entry['reductionPercent']:.1f}% | {entry['backends']['wasm']['AP']:.2f} | {entry['backends']['webgpu']['AP']:.2f} | {entry['backends']['wasm']['inferenceMs']:.2f} | {entry['backends']['webgpu']['inferenceMs']:.2f} |")
summary['status']='passed';(REPORT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(REPORT/'artifact-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
text='''# PicoDet 与 PP-YOLOE 三精度对比

日期：2026-09-12。FP16 与 W8A32 的文件缩小独立计为收益；是否加速按具体后端数据判断。两模型、三精度、两后端各三轮，共36组完整64图运行。三轮FP32/FP16/W8A32在同一环境交替串行执行，AP均稳定。

| 模型 | 精度 | 文件 MB | 体积减少 | WASM AP | WebGPU AP | WASM 热推理 ms | WebGPU 热推理 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
'''+ '\n'.join(rows)+'''

体积为十进制 MB；AP为0–100，固定COCO val2017 64图、716标注，并非全量COCO指标。识别质量使用三轮数据；为排除前两轮与独立界面测试可能重叠的影响，表中耗时只采用界面测试结束后的第三轮63张热推理中位数，排除首张，不能据此宣称稳定加速。前两轮原始耗时仍完整保留。下载使用本机HTTP，文件字节传入SDK，不含公网下载时间；会话创建、首图、热端到端和P90见summary.json。计时不包含测试工具预取JPEG的请求。

环境：Windows 11 10.0.26200，Intel i5-10400F，NVIDIA Blackwell物理适配器，Chromium 153.0.8010.12，ONNX Runtime Web 1.27.0，SDK 0.3.1，main模式，WASM单线程，跨域隔离；明确请求后端且关闭回退。每轮记录SDK/模型/清单SHA-256。WebGPU的部分算子可能由ORT分配给CPU，详见原始警告。

FP16为混合精度：PicoDet保留Cast_5和默认敏感算子边界，PP-YOLOE额外保留4个ReduceMean为FP32，避免已定位的半精度归约溢出。两模型浮点输入输出仍为FP32，检测数量INT32。W8A32仅将卷积权重按通道INT8存储，经反量化参与FP32卷积；激活保持FP32，SDK precision=int8，quantization=weight-only-int8-activation-fp32。

验收检查每组合三轮运行、实际后端与模型身份、固定数据集AP相对FP32下降不超过0.5点，并在score>=0.5、同类IoU>=0.5的一对一匹配中保留至少95%的FP32检测。具体增减框、最大分数和坐标差见summary.json及parity/。小数点级AP增减不代表模型更准确，识别通过不等于逐框完全相同。

此次发布判断接受体积收益，按用户指示将通过验收的变体分发上线。FP16/W8A32没有手机实测、峰值内存或其他浏览器承诺；原FP32的小米15反馈仅覆盖FP32。文件减小不能直接推导内存同比减小。默认精度FP32，默认来源ModelScope，另提供Hugging Face。新的版本化清单与旧FP32资产分别保留可追溯的不可变来源。

原始JSON以gzip归档，artifact-index.json记录压缩前后摘要。转换、分发回下载和生产Demo验证见本目录后续记录。
'''
(REPORT/'README.md').write_text(text,encoding='utf-8');print('36组通过，报告已生成',flush=True)
