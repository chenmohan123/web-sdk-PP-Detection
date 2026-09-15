"""完全隔离的发布状态机测试；不访问真实Hub、不写产品根目录。"""
import copy
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('tiny_publish', Path(__file__).with_name('publish.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    for name, value in {'ROOT': tmp_path, 'REPORT': tmp_path/'report', 'STAGE': tmp_path/'stage',
                        'QUALITY': tmp_path/'quality', 'PRODUCT': tmp_path/'product', 'MODEL': tmp_path/'model.onnx'}.items():
        monkeypatch.setattr(p, name, value)
    p.REPORT.mkdir()
    p.PRODUCT.mkdir()
    monkeypatch.setattr(p, 'evidence_files', lambda: {'证据': {'bytes': 1, 'sha256': '摘要'}})
    monkeypatch.setattr(p, 'input_files', lambda: {'图片': {'bytes': 1, 'sha256': '摘要'}})
    for name in ('README.md', 'LICENSE', 'conversion.json'):
        (p.PRODUCT/name).write_bytes(name.encode())
        path = p.STAGE/'weights'/p.PREFIX/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((p.PRODUCT/name).read_bytes())
    (p.STAGE/'weights'/p.PREFIX/p.FILENAME).write_bytes(b'weight')
    (p.REPORT/'hub-README.md').write_bytes(b'root')
    p.dump(p.REPORT/'protocol.json', {'sdkSha256': 'sdk', 'previousRoot': {'bytes': 3, 'sha256': p.sha(b'old')}})
    p.dump(p.REPORT/'prepare-receipt.json', {'protocolSha256': p.digest(p.REPORT/'protocol.json'),
           'publisherSha256': p.digest(Path(p.__file__)), 'evidence': p.evidence_files(), 'inputs': p.input_files(),
           'weightsFiles': p.files('weights'), 'hubReadme': p.identity(p.REPORT/'hub-README.md')})
    remote = {}
    monkeypatch.setattr(p, 'remote_head', lambda source: ('1' if source == 'modelscope' else '2') * 40)
    monkeypatch.setattr(p, 'remote_paths', lambda source, revision: set())
    def upload(source, phase, parent):
        revision = ('3' if source == 'modelscope' else '4')*40
        for item in p.files(phase):
            remote[p.url(source, revision, item['path'])] = {k:item[k] for k in ('bytes', 'sha256')}
        return revision
    monkeypatch.setattr(p, 'upload_folder', upload)
    monkeypatch.setattr(p, 'remote_identity', lambda address: remote[address])
    return remote


def test_upload_then_complete_get_and_resume(sandbox):
    p.publish('weights')
    assert len(p.uploads('weights')) == 2
    p.verify('weights')
    p.validate_downloads('weights')
    original = (p.REPORT/'weights-uploads.json').read_bytes()
    p.publish('weights')
    assert (p.REPORT/'weights-uploads.json').read_bytes() == original
    assert len(p.load(p.REPORT/'weights-downloads.json')['results']) == 8


@pytest.mark.parametrize('mutation', ['extra', 'missing', 'sha', 'protocol', 'receipt', 'evidence', 'product'])
def test_mutation_rejected_before_upload(sandbox, monkeypatch, mutation):
    if mutation == 'extra':
        (p.STAGE/'weights'/'额外文件').write_bytes(b'extra')
    elif mutation == 'missing':
        (p.STAGE/'weights'/p.PREFIX/p.FILENAME).unlink()
    elif mutation == 'sha':
        (p.STAGE/'weights'/p.PREFIX/p.FILENAME).write_bytes(b'changed')
    elif mutation == 'protocol':
        p.dump(p.REPORT/'protocol.json', {'changed': True})
    elif mutation == 'receipt':
        v = p.load(p.REPORT/'prepare-receipt.json'); v['weightsFiles'] = []
        p.dump(p.REPORT/'prepare-receipt.json', v)
    elif mutation == 'evidence':
        monkeypatch.setattr(p, 'evidence_files', lambda: {})
    else:
        (p.PRODUCT/'LICENSE').write_bytes(b'changed')
    monkeypatch.setattr(p, 'upload_folder', lambda *a: pytest.fail('不应开始远程写入'))
    with pytest.raises(ValueError):
        p.publish('weights')


@pytest.mark.parametrize('mutation', ['duplicate', 'revision', 'files', 'receipt', 'source'])
def test_upload_record_mutation_rejected(sandbox, mutation):
    p.publish('weights')
    rows = p.load(p.REPORT/'weights-uploads.json')
    if mutation == 'duplicate': rows.append(copy.deepcopy(rows[0]))
    if mutation == 'revision': rows[0]['revision'] = 'fake'
    if mutation == 'files': rows[0]['files'].append({'path': 'extra'})
    if mutation == 'receipt': rows[0]['receiptSha256'] = 'wrong'
    if mutation == 'source': rows[0]['source'] = 'other'
    p.dump(p.REPORT/'weights-uploads.json', rows)
    with pytest.raises(ValueError): p.verify('weights')


def test_wrong_full_get_rejected_without_pass_receipt(sandbox):
    p.publish('weights')
    sandbox[next(iter(sandbox))]['sha256'] = 'wrong'
    with pytest.raises(ValueError, match='完整GET'):
        p.verify('weights')
    assert not (p.REPORT/'weights-downloads.json').exists()


def test_download_receipt_rejects_changed_upload_state(sandbox):
    p.publish('weights'); p.verify('weights')
    rows = p.load(p.REPORT/'weights-uploads.json')
    rows[0]['revision'] = '5'*40
    p.dump(p.REPORT/'weights-uploads.json', rows)
    with pytest.raises(ValueError): p.validate_downloads('weights')


def test_existing_version_rejected(sandbox, monkeypatch):
    monkeypatch.setattr(p, 'remote_paths', lambda *a: {p.PREFIX+'old'})
    monkeypatch.setattr(p, 'upload_folder', lambda *a: pytest.fail('不可覆盖版本'))
    with pytest.raises(ValueError, match='禁止覆盖'): p.publish('weights')


def test_manifest_requires_downloads_and_preserves_runtime(sandbox, monkeypatch):
    template = {'schemaVersion': 1, 'model': {}, 'input': {'x': [1, 3, 320, 320]}, 'outputs': ['output'],
                'preprocessing': {'scale': 1/255}, 'postprocessing': {'kind': 'nms'}, 'labels': ['人'],
                'variants': [{'id': 'fp32', 'opset': 14, 'sources': []}]}
    monkeypatch.setattr(p, 'gunzip', lambda name: template)
    with pytest.raises(ValueError): p.manifests()
    assert not (p.PRODUCT/'manifest.json').exists()
    p.publish('weights'); p.verify('weights'); p.manifests()
    manifest = p.load(p.PRODUCT/'manifest.json')
    assert len(manifest['variants']) == 1 and len(manifest['variants'][0]['sources']) == 2
    for key in ('input', 'outputs', 'preprocessing', 'postprocessing', 'labels'):
        assert manifest[key] == template[key]


def test_prepare_wrong_model_sha_rejected(sandbox):
    p.MODEL.write_bytes(b'incorrect')
    with pytest.raises(ValueError, match='本地权重'): p.prepare()


def test_missing_raw_evidence_fails_recomputation(sandbox, monkeypatch):
    class Failed:
        returncode = 1
        stderr = '缺少原始证据'
    monkeypatch.setattr(p.subprocess, 'run', lambda *a, **k: Failed())
    with pytest.raises(ValueError, match='归档复算失败'): p.require_quality()


@pytest.mark.parametrize('rounds', [[1, 2], [1, 1, 3]])
def test_missing_or_duplicate_round_rejected(sandbox, monkeypatch, rounds):
    class Passed:
        returncode = 0
        stderr = ''
        stdout = '{}'
    monkeypatch.setattr(p.subprocess, 'run', lambda *a, **k: Passed())
    sdk = p.ROOT/'packages/sdk/dist/browser-global.js'; sdk.parent.mkdir(parents=True); sdk.write_bytes(b'sdk')
    p.dump(p.QUALITY/'summary.json', {'sdk':'0.4.0', 'imageCount':64, 'sdkSha256':p.digest(sdk),
           'rows':[{'model':'tiny', 'backend':'wasm', 'sha256':p.SHA, 'bytes':p.BYTES, 'rounds':[{'round':r} for r in rounds]}]})
    with pytest.raises(ValueError, match='轮次'): p.require_quality()


def test_metadata_requires_browser_and_cas(sandbox, monkeypatch):
    p.publish('weights'); p.verify('weights')
    (p.PRODUCT/'manifest.json').write_text('{}')
    called = []
    monkeypatch.setattr(p, 'validate_browser', lambda: called.append('browser'))
    monkeypatch.setattr(p, 'remote_paths', lambda *a: {x['path'] for x in p.expected_files('weights')})
    def remote(address):
        if address.endswith('/README.md') and p.PREFIX not in address:
            return {'bytes': 5, 'sha256': p.sha(b'other')}
        item = next(x for x in p.expected_files('weights') if address.endswith('/'+x['path']))
        return {k:item[k] for k in ('bytes','sha256')}
    monkeypatch.setattr(p, 'remote_identity', remote)
    monkeypatch.setattr(p, 'upload_folder', lambda *a: pytest.fail('CAS失败不应写入'))
    with pytest.raises(ValueError, match='前值改变'): p.publish('metadata')
    assert called == ['browser']


def test_metadata_extra_file_rejected(sandbox, monkeypatch):
    monkeypatch.setattr(p, 'validate_browser', lambda: None)
    (p.PRODUCT/'manifest.json').write_text('{}')
    folder = p.STAGE/'metadata'; folder.mkdir(); (folder/'额外文件').write_bytes(b'x')
    with pytest.raises(ValueError, match='多余'): p.publish('metadata')


def test_streaming_get_hashes_every_chunk(monkeypatch):
    import requests
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def raise_for_status(self): pass
        def iter_content(self, size): return iter([b'ab', b'', b'cd', b'ef'])
    calls = []
    def get(address, **kwargs):
        calls.append((address, kwargs)); return Response()
    monkeypatch.setattr(requests, 'get', get)
    assert p.remote_identity('https://example.invalid/model') == {'bytes': 6, 'sha256': p.sha(b'abcdef')}
    assert calls[0][1]['stream'] is True


def test_metadata_success_upload_and_complete_get(sandbox, monkeypatch):
    p.publish('weights'); p.verify('weights')
    (p.PRODUCT/'manifest.json').write_text('{}')
    monkeypatch.setattr(p, 'validate_browser', lambda: None)
    monkeypatch.setattr(p, 'remote_paths', lambda *a: {x['path'] for x in p.expected_files('weights')})
    original_remote = p.remote_identity
    def remote(address):
        if address in sandbox: return original_remote(address)
        if address.endswith('/README.md') and p.PREFIX not in address:
            return p.load(p.REPORT/'protocol.json')['previousRoot']
        item = next(x for x in p.expected_files('weights') if address.endswith('/'+x['path']))
        return {k:item[k] for k in ('bytes','sha256')}
    monkeypatch.setattr(p, 'remote_identity', remote)
    p.publish('metadata'); p.verify('metadata'); p.validate_downloads('metadata')
    assert len(p.load(p.REPORT/'metadata-downloads.json')['results']) == 10
    assert {r['path'] for r in p.files('metadata')} == {'README.md', *(p.PREFIX+n for n in ('manifest.json','README.md','LICENSE','conversion.json'))}


@pytest.mark.parametrize('mutation', ['valid', 'missing', 'duplicate', 'source', 'cache', 'manifest', 'runtime', 'receipt'])
def test_browser_evidence_is_bound_and_checks_real_actions(sandbox, monkeypatch, mutation):
    manifest = {'variants':[{'sources':[{'kind':s, 'revision':'6'*40, 'sha256':p.SHA} for s in p.SOURCES]}]}
    p.dump(p.PRODUCT/'manifest.json', manifest)
    monkeypatch.setattr(p, 'final_manifest', lambda: manifest)
    worker = p.ROOT/'packages/sdk/dist/inference.worker.js'; worker.parent.mkdir(parents=True); worker.write_bytes(b'worker')
    rows = []
    for source, backend, mode in p.itertools.product(p.SOURCES, ('wasm','webgpu'), ('main','worker')):
        model = {'id':'ppyolo-tiny-320','version':'0.1.0','variantId':'fp32','bytes':p.BYTES,
                 'source':{'kind':source,'revision':'6'*40,'sha256':p.SHA}}
        runtime = {'backend':backend,'requestedBackend':backend,'mode':mode,'precision':'fp32','fallbacks':[]}
        row = {'sourceKind':source,'backend':backend,'executionMode':mode,'status':'passed','abortCode':'ABORTED','disposedCode':'DISPOSED',
               'model':model,'runtime':runtime,'detections':[{'label':'人'}],'recovered':[{'label':'人'}],
               'cached':{'model':copy.deepcopy(model),'runtime':copy.deepcopy(runtime),'detections':[{'label':'人'}]}}
        row.update({key:{'modelSource':value,'integrityMs':1} for key,value in [('firstLoad','network'),('cachedLoad','cache'),('reloaded','network')]})
        row.update({key:{'entries':1,'bytes':p.BYTES} for key in ('firstCache','reloadedCache')})
        row.update({key:{'entries':0,'bytes':0} for key in ('afterCurrentClear','afterAllClear')})
        rows.append(row)
    browser = {'status':'passed','modelSha256':p.SHA,'modelBytes':p.BYTES,'manifestSha256':p.digest(p.PRODUCT/'manifest.json'),
               'sdkSha256':'sdk','workerSha256':p.digest(worker),**p.binding(),'rows':rows}
    if mutation == 'missing': rows.pop()
    if mutation == 'duplicate': rows[-1] = copy.deepcopy(rows[0])
    if mutation == 'source': rows[0]['model']['source']['revision'] = 'wrong'
    if mutation == 'cache': rows[0]['cachedLoad']['modelSource'] = 'network'
    if mutation == 'manifest': browser['manifestSha256'] = 'wrong'
    if mutation == 'runtime': rows[0]['runtime']['mode'] = 'worker'
    if mutation == 'receipt': browser['receiptSha256'] = 'wrong'
    p.dump(p.REPORT/'browser.json', browser)
    if mutation == 'valid': p.validate_browser()
    else:
        with pytest.raises(ValueError): p.validate_browser()
