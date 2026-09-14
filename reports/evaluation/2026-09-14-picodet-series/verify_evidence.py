"""检查本轮发布证据的规格覆盖、文件身份与实际运行结果。"""
from pathlib import Path
import gzip
import hashlib
import json

ROOT=Path(__file__).resolve().parents[3]
REPORT=Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_bytes())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(value, message):
    if not value: raise ValueError(message)


def main():
    expected={f'picodet-{size}-{resolution}' for size in ('xs','s','m') for resolution in (320,416)}|{'picodet-l-320','picodet-l-416','picodet-l-640'}
    jobs=read(REPORT/'jobs.json')
    require(len(jobs)==9 and {x['key'] for x in jobs}==expected,'九规格 jobs 不完整')
    manifests={x['key']:ROOT/x['manifest'] for x in jobs}
    for job in jobs:
        manifest=read(manifests[job['key']])
        variant=manifest['variants'][0]
        require(manifest['status']=='stable' and variant['status']=='stable','清单状态不符')
        require(manifest['defaultSource']=='modelscope','默认来源不符')
        require((variant['bytes'],variant['sha256'])==(job['bytes'],job['sha256']),'模型身份不符')
        require({x['kind'] for x in variant['sources']}=={'modelscope','huggingface'},'来源集合不符')
        require(manifest['input']['shape']==[1,3,job['inputSize'],job['inputSize']],'输入尺寸不符')
    artifacts=read(REPORT/'artifact-index.json')
    require(len(artifacts)==18,'浏览器评测数量不符')
    for entry in artifacts:
        data=(REPORT/entry['path']).read_bytes()
        require(len(data)==entry['bytes'] and sha(data)==entry['sha256'],'压缩证据不符')
        raw=gzip.decompress(data)
        require(len(raw)==entry['uncompressedBytes'] and sha(raw)==entry['uncompressedSha256'],'解压证据不符')
        result=json.loads(raw)
        require(result['status']=='passed' and len(result['images'])==64,'浏览器64图评测未通过')
        key=entry['path'].split('-wasm')[0].split('-webgpu')[0]
        require(result['artifacts']['model']['sha256']==read(manifests[key])['variants'][0]['sha256'],'浏览器模型身份不符')
    quality=read(REPORT/'quality.json')
    require(len(quality['models'])==9 and quality['allPassed'],'质量证据不完整')
    for model in quality['models']:
        require(len(model['runs'])==3,'缺少参考质量结果')
        require(model['referenceSha256']!=model['candidateSha256'],'禁止候选自比较')
        for run in model['runs']:
            require(run['passed'] and run['apDeltaPoints']>=-.5 and run['retention']['fraction']>=.95,'识别门槛未通过')
        require(sha((REPORT/model['predictions']['path']).read_bytes())==model['predictions']['sha256'],'Python检测归档不符')
    for filename,count in [('desktop-smoke.json',36),('remote-smoke.json',18)]:
        smoke=read(REPORT/filename)
        require(len(smoke['rows'])==count,'生命周期或来源覆盖不完整')
        require(sha((ROOT/'packages/sdk/dist/browser-global.js').read_bytes())==smoke['sdkSha256'],'SDK构建身份不符')
        keys=set()
        for row in smoke['rows']:
            require(row['status']=='passed' and row['abortCode']=='ABORTED' and row['disposedCode']=='DISPOSED','生命周期结果不符')
            require(row['runtime']['backend']==row['backend'] and row['runtime']['mode']==row['executionMode'] and not row['runtime']['fallbacks'],'运行后端或模式不符')
            require(row['detections'] and row['detections']==row['recovered'],'恢复检测不一致')
            require(sha(manifests[row['key']].read_bytes())==row['artifacts']['manifest']['sha256'],'最终清单字节身份不符')
            keys.add((row['key'],row.get('sourceKind') if filename.startswith('remote') else row['backend'],row['executionMode']))
        require(len(keys)==count,'证据包含重复组合')
    require(len(read(REPORT/'downloads.json'))==16,'远端权重数量不符')
    require(len(read(REPORT/'metadata-downloads.json'))==48,'远端元数据数量不符')
    for upload in read(REPORT/'metadata-uploads.json'):
        for item in upload['files']:
            key,_,name=item['path'].split('/')
            require(sha((ROOT/'models/pp-detection'/key/name).read_bytes())==item['sha256'],'已上传元数据被修改')
    print('九规格、18 份64图评测、质量门槛、36组生命周期、18次远端推理、16份权重和48份元数据：通过')


if __name__=='__main__':
    main()
