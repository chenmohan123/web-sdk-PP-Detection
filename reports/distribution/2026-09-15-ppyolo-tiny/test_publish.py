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
