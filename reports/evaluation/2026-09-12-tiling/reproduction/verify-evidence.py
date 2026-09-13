"""复核已保存的本地证据，并生成轻量哈希索引。不会重新推理或覆盖输入锁。"""
from pathlib import Path
import gzip,hashlib,json,subprocess

OUT=Path(__file__).resolve().parents[1]
ROOT=Path(__file__).resolve().parents[4]
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
inputs=read(OUT/'inputs.json');summary=read(OUT/'summary.json')
assert sha(OUT/'protocol.md')==inputs['protocolSha256']
assert sha(Path(inputs['sdkBundle']))==inputs['sdkSha256'], '重新构建改变了正式 bundle 字节，需要说明差异'
assert len(summary['rows'])==36 and len(summary['runs'])==12
for evidence in summary['runs']:
    path=OUT/evidence['file'];assert sha(path)==evidence['sha256'] and path.stat().st_size==evidence['bytes']
    run=json.loads(gzip.decompress(path.read_bytes()))
    for name,value in run['scripts'].items():assert sha(OUT/'reproduction'/name)==value
    for image in run['images']:
        assert all(x>=0 for x in image['modeMs'].values())
        assert abs(image['modeMs']['whole']-image['decodeMs']-image['wholeMs'])<1e-5
        assert abs(image['modeMs']['combined']-sum(image[k] for k in ['decodeMs','wholeMs','cropMs','tileDetectMs','projectMs','combinedMergeMs']))<1e-5
        assert len(image['tiles'])==4
for case in read(OUT/'cases.json'):
    assert (OUT/case['file']).is_file() and case['source']['license']['url']
for name in ['standard-before.json','standard-after.json']:
    report=read(OUT/name)['repositories'][0]['summary']
    assert report['requiredPassed']==18 and report['requiredFailed']==0 and report['requiredSkipped']==4
assert not subprocess.check_output(['git','diff','--name-only','HEAD','--','packages','apps','models','sdk-manifest.yaml'],cwd=ROOT,text=True).strip()
files=[]
for path in sorted(OUT.rglob('*')):
    if not path.is_file() or '__pycache__' in path.parts or path.name=='evidence-index.json':continue
    relative=path.relative_to(OUT).as_posix();local=path.suffix=='.gz' or path.suffix=='.jpg'
    files.append(dict(path=relative,bytes=path.stat().st_size,sha256=sha(path),localOnly=local))
index={'protocolSha256':inputs['protocolSha256'],'inputsSha256':sha(OUT/'inputs.json'),'sdkSha256':inputs['sdkSha256'],'files':files,'localOnlyBytes':sum(x['bytes'] for x in files if x['localOnly'])}
(OUT/'evidence-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'通过：12 个完整组合、36 行汇总、原始文件哈希、脚本字节、耗时分解、案例来源、前后规范与产品文件不变；索引 {len(files)} 件')
