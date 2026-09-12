"""独立复核实验链、样本、坐标/合并重算、身份和报告索引。"""
from pathlib import Path
import json,gzip,hashlib,datetime,subprocess,zipfile,importlib.util
OUT=Path(__file__).resolve().parents[1];ROOT=OUT.parents[2]
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
inputs=read(OUT/'inputs.json');summary=read(OUT/'holdout-summary.json');selection=read(OUT/'selection.json');lock=read(OUT/'holdout-lock.json')
assert sha(OUT/'protocol.md')==inputs['protocolSha256']==selection['protocolSha256']
assert sha(OUT/'selection.json')==inputs['selectionSha256']==summary['selectionSha256']
assert sha(OUT/'reproduction/merge.mjs')==selection['mergeSha256']
assert sha(Path(inputs['sdkBundle']))==inputs['sdkSha256']
assert len(summary['runs'])==8 and len(summary['rows'])==24
assert sha(OUT/'holdout-lock.json')==inputs['holdoutSha256']==summary['datasetSha256']
assert sha(OUT/'holdout-annotations.json')==inputs['annotationsSha256']==lock['annotationsSha256']
data=read(OUT/'holdout-annotations.json');noncrowd=[a for a in data['annotations'] if not a['iscrowd']]
assert len(noncrowd)==lock['nonCrowd']==2363
assert sum(a['area']<1024 for a in noncrowd)==lock['small']==1545
assert sum(a['area']>9216 for a in noncrowd)==lock['large']==80
assert len({i['sha256'] for i in lock['images']})==32 and max(lock['sequenceCounts'].values())<=2
for image in lock['images']:
    path=Path(inputs['imageRoot'])/image['filename'];assert sha(path)==image['sha256'] and path.stat().st_size==image['bytes']
    assert max(image['width'],image['height'])>=1280
sources=read(OUT/'sources.json')
assert sha(OUT/'sources.json')==lock['sourcesSha256']
for source in sources:assert sha(Path(source['file']))==source['sha256']
with zipfile.ZipFile(next(s['file'] for s in sources if s['file'].endswith('.zip'))) as archive:
    for image in lock['images']:
        assert hashlib.sha256(archive.read(image['file'])).hexdigest()==image['sha256']
        assert hashlib.sha256(archive.read(image['annotation'])).hexdigest()==image['annotationSha256']
for run in summary['runs']:
    path=OUT/run['file'];assert sha(path)==run['sha256'];raw=json.loads(gzip.decompress(path.read_bytes()))
    assert raw['status']=='passed' and not raw['pageErrors'] and len(raw['images'])==32
    assert datetime.datetime.fromisoformat(raw['startedAt'].replace('Z','+00:00'))>datetime.datetime.fromisoformat(selection['frozenAt'])
    assert raw['selectionSha256']==inputs['selectionSha256'] and raw['inputsSha256']==sha(OUT/'inputs.json')
    for script,digest in raw['scripts'].items():assert sha(OUT/'reproduction'/script)==digest
    assert raw['initialization']['sdkVersion']=='0.3.2' and raw['initialization']['runtime']['backend']==raw['backend'] and not raw['initialization']['runtime']['fallbacks']
    if raw['backend']=='webgpu':assert raw['adapter']['isFallbackAdapter'] is False and raw['adapter']['vendor']=='nvidia'
    for image in raw['images']:
        expected=sum(image[k] for k in ['decodeMs','wholeMs','cropMs','tileDetectMs','projectMs','refinementMs'])
        assert abs(expected-image['modeMs']['refined'])<1e-5
        # 固定候选必须原样保留所有强整图框。
        strong=[d for d in image['whole'] if d['score']>=.5]
        assert image['refined'][:len(strong)]==strong
for row in summary['rows']:assert row['operating']['tp']+row['operating']['fn']==2363
for phase in ['before','after']:
    s=read(OUT/f'standard-{phase}.json')['repositories'][0]['summary'];assert s['requiredPassed']==18 and s['requiredFailed']==0 and s['requiredSkipped']==4
assert not subprocess.check_output(['git','diff','--name-only','152b176','--','packages','apps','models','sdk-manifest.yaml'],cwd=ROOT,text=True).strip()
index=[]
for path in sorted(OUT.rglob('*')):
    if not path.is_file() or '__pycache__' in path.parts or path.name=='evidence-index.json':continue
    rel=path.relative_to(OUT).as_posix();local=rel.startswith(('browser/','predictions/')) or path.suffix in ['.gz','.jpg'] or path.name=='holdout-annotations.json'
    index.append(dict(path=rel,bytes=path.stat().st_size,sha256=sha(path),localOnly=local))
(OUT/'evidence-index.json').write_text(json.dumps(dict(files=index,smallBoundary1024=sum(a['area']==1024 for a in noncrowd),largeBoundary9216=sum(a['area']==9216 for a in noncrowd),localOnlyBytes=sum(i['bytes'] for i in index if i['localOnly'])),ensure_ascii=False,indent=2),encoding='utf-8')
print('通过：冻结时间先于独立推理、源数据字节、32图标注与分组、8组合身份、强整图框保留、计时分解、前后规范及产品代码不变；索引',len(index),'件')
