"""复用上轮一次性浏览器探针，加入冻结策略；不修改旧探针。"""
from pathlib import Path
import json,hashlib
OUT=Path(__file__).resolve().parents[1];OLD=OUT.parent/'2026-09-12-tiling';HERE=OUT/'reproduction'
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
selection=read(OUT/'selection.json');assert selection['mergeSha256']==sha(HERE/'merge.mjs')
lock=read(OUT/'holdout-lock.json');old=read(OLD/'inputs.json')
inputs=dict(old,outputs=str(OUT/'browser'),imageRoot=lock['imageRoot'],annotations=str(OUT/'holdout-annotations.json'),annotationsSha256=lock['annotationsSha256'],protocolSha256=sha(OUT/'protocol.md'),images=[dict(id=i['imageId'],file_name=i['filename'],width=i['width'],height=i['height'],sha256=i['sha256']) for i in lock['images']],nonCrowd=lock['nonCrowd'],small=lock['small'],selectionSha256=sha(OUT/'selection.json'),holdoutSha256=sha(OUT/'holdout-lock.json'))
(OUT/'inputs.json').write_text(json.dumps(inputs,ensure_ascii=False,indent=2),encoding='utf-8');(OUT/'browser').mkdir(exist_ok=True)
(HERE/'tiling.mjs').write_bytes((OLD/'reproduction/tiling.mjs').read_bytes())
source=(OLD/'reproduction/browser-probe.mjs').read_text(encoding='utf-8')
def replace(a,b):
    global source
    assert source.count(a)==1,(a,source.count(a));source=source.replace(a,b)
replace("const model=inputs.models.find", "const selectionBytes=await readFile(join(out,'selection.json')),selection=JSON.parse(selectionBytes);\nif(sha(selectionBytes)!==inputs.selectionSha256||sha(await readFile(join(here,'merge.mjs')))!==selection.mergeSha256)throw new Error('冻结策略字节发生变化');\nconst model=inputs.models.find")
replace("const html=", "routes.set('/merge.mjs',join(here,'merge.mjs'));\nroutes.set('/2026-09-12-tiling/reproduction/tiling.mjs',join(here,'tiling.mjs'));\nconst html=")
replace("const result={status:","const result={strategy:selection.chosen,selectionSha256:sha(selectionBytes),status:")
replace("['browser-probe.mjs','tiling.mjs']", "['run-holdout.mjs','tiling.mjs','merge.mjs']")
replace("async({backend,precision,manifest,origin})", "async({backend,precision,manifest,origin,strategy})")
replace("globalThis.probeTiling=await import('/tiling.mjs');", "globalThis.probeTiling=await import('/tiling.mjs');\n    globalThis.probeRefine=await import('/merge.mjs');globalThis.probeStrategy=strategy;")
replace("{backend,precision:model.precision,manifest,origin}", "{backend,precision:model.precision,manifest,origin,strategy:selection.chosen}")
replace("return {imageId:image.id,fileName:image.file_name", "const refineStart=performance.now(),refinement=globalThis.probeRefine.refine({whole:whole.detections,tiles,width:raster.width,height:raster.height},globalThis.probeStrategy),refinementMs=performance.now()-refineStart;\n      return {refined:refinement.detections,refinementTrace:refinement.trace,refinementMs,imageId:image.id,fileName:image.file_name")
replace("modeMs:{whole:", "modeMs:{refined:decodeMs+wholeMs+cropMs+tileDetectMs+projectMs+refinementMs,whole:")
replace("limit===64", "limit===inputs.images.length")
(HERE/'run-holdout.mjs').write_text(source,encoding='utf-8')
print('独立集输入与浏览器探针已生成；冻结策略',selection['chosen'])
