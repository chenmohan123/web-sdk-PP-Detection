import json, pathlib, pytest, sys
sys.path.insert(0,str(pathlib.Path(__file__).parent)); import publish
def test_wrong_digest_rejected(monkeypatch):
 monkeypatch.setattr(publish,'SHA','0'*64)
 with pytest.raises(AssertionError): publish.prepare()
def test_quality_required():
 s=publish.require_quality(); assert s['imageCount']==64
def test_manifest_waits_for_revisions(tmp_path,monkeypatch):
 monkeypatch.setattr(publish,'REPORT',tmp_path)
 with pytest.raises(AssertionError): publish.manifests()
def test_status_duplicate_rejected(tmp_path,monkeypatch):
 p=tmp_path/'weights-uploads.json'; p.write_text(json.dumps([{'source':'modelscope','revision':'a'*40},{'source':'modelscope','revision':'b'*40},{'source':'huggingface','revision':'c'*40}]))
 monkeypatch.setattr(publish,'REPORT',tmp_path)
 with pytest.raises(AssertionError): publish.manifests()
def test_extra_stage_file_rejected(tmp_path,monkeypatch):
 monkeypatch.setattr(publish,'STAGE',tmp_path); d=tmp_path/'weights/ppyolo-tiny-320/0.1.0'; d.mkdir(parents=True); (d/'extra').write_text('x')
 monkeypatch.setattr(publish,'MODEL',d/'m'); monkeypatch.setattr(publish,'BYTES',1); monkeypatch.setattr(publish,'SHA',publish.digest(d/'extra'))
 with pytest.raises(AssertionError): publish.verify_weights()
