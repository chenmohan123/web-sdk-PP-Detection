"""ModelScope 覆盖 JSON 时换行规范化的恢复测试。"""
import importlib.util
import json
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location("tiny_metadata_repair", Path(__file__).with_name("repair_metadata.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def test_normalize_json_lf_preserves_value_and_removes_crlf(tmp_path):
    path = tmp_path / "conversion.json"
    value = {"precision": "fp16", "nodes": ["Exp.0", "Exp.2", "Exp.4"]}
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\r\n").replace("\n", "\r\n").replace("\r\r\n", "\r\n").encode())
    before = path.read_bytes()
    assert b"\r\n" in before

    identity = r.normalize_json_lf(path)

    after = path.read_bytes()
    assert json.loads(after) == value
    assert b"\r\n" not in after
    assert after.endswith(b"\n")
    assert identity == {"bytes": len(after), "sha256": r.sha(after)}


def test_normalize_json_lf_rejects_non_object(tmp_path):
    path = tmp_path / "conversion.json"
    path.write_text("[]\n", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON 对象"):
        r.normalize_json_lf(path)


class _PreflightPublisher:
    REPORT = Path()
    STAGE = Path()
    PRODUCT = Path()
    SOURCES = ("modelscope", "huggingface")
    PREFIX = "ppyolo-tiny-320/0.1.1/"
    REPOSITORY = "repo"
    FP16_FILENAME = "ppyolo-tiny-320-fp16.onnx"
    FP16_BYTES = 1
    FP16_SHA = "x"

    def __init__(self, tmp_path, *, binding_error=None, extra=False):
        self.REPORT = tmp_path / "report"
        self.STAGE = tmp_path / "stage"
        self.PRODUCT = tmp_path / "product"
        self.REPORT.mkdir()
        (self.STAGE / "metadata" / self.PREFIX).mkdir(parents=True)
        self.PRODUCT.mkdir()
        conversion = b'{\n  "precision": "fp16"\n}\n'
        (self.PRODUCT / "fp16-conversion.json").write_bytes(conversion)
        (self.STAGE / "metadata" / self.PREFIX / "fp16-conversion.json").write_bytes(conversion)
        (self.PRODUCT / "manifest.json").write_bytes(b"manifest\n")
        (self.STAGE / "metadata" / self.PREFIX / "manifest.json").write_bytes(b"manifest\n")
        if extra:
            (self.STAGE / "metadata" / self.PREFIX / "w8a32.onnx").write_bytes(b"forbidden")
        self.upload_calls = []
        self.binding_error = binding_error

    def binding(self):
        if self.binding_error:
            raise ValueError(self.binding_error)
        return {"protocolSha256": "p", "receiptSha256": "r"}

    def validate_downloads(self, phase):
        assert phase == "weights"

    def validate_browser(self):
        return None

    def uploads(self, phase):
        return self.load(self.REPORT / f"{phase}-uploads.json")

    def identity(self, path):
        return r.identity(path)

    def load(self, path):
        return json.loads(path.read_text(encoding="utf-8"))

    def dump(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    def files(self, phase):
        folder = self.STAGE / phase
        return sorted(
            [{"path": item.relative_to(folder).as_posix(), **r.identity(item)} for item in folder.rglob("*") if item.is_file()],
            key=lambda item: item["path"],
        )

    def expected_files(self, phase):
        return self.files(phase)


def test_preflight_rejects_binding_before_any_upload(tmp_path):
    publisher = _PreflightPublisher(tmp_path, binding_error="准备绑定错误")
    with pytest.raises(ValueError, match="准备绑定错误"):
        r.preflight(publisher)
    assert publisher.upload_calls == []


def test_preflight_rejects_extra_w8a32_before_any_upload(tmp_path):
    publisher = _PreflightPublisher(tmp_path, extra=True)
    files = publisher.files("metadata")
    for item in files:
        if item["path"].endswith("fp16-conversion.json"):
            crlf = publisher.PRODUCT.joinpath("fp16-conversion.json").read_bytes().replace(b"\n", b"\r\n")
            item.update({"bytes": len(crlf), "sha256": r.sha(crlf)})
    rows = [
        {"source": source, "revision": digit * 40, "files": files, "phase": "metadata", "repository": publisher.REPOSITORY, **publisher.binding()}
        for source, digit in (("modelscope", "1"), ("huggingface", "2"))
    ]
    (publisher.REPORT / "metadata-uploads.json").write_text(json.dumps(rows), encoding="utf-8")
    with pytest.raises(ValueError, match="W8A32"):
        r.preflight(publisher)
    assert publisher.upload_calls == []


def test_successful_reentry_is_noop_before_normalization(tmp_path, monkeypatch):
    publisher = _PreflightPublisher(tmp_path)
    (publisher.REPORT / "metadata-uploads.json").write_text("[]\n", encoding="utf-8")
    monkeypatch.setattr(publisher, "uploads", lambda phase: [{"source": "modelscope"}, {"source": "huggingface"}])
    monkeypatch.setattr(r, "publisher", lambda: publisher)
    monkeypatch.setattr(r, "normalize_json_lf", lambda path: pytest.fail("重入不得规范化写入"))
    r.main()
    assert publisher.upload_calls == []


def test_partial_retry_uses_independent_progress(tmp_path):
    publisher = _PreflightPublisher(tmp_path)
    first = [
        {"source": source, "revision": digit * 40, "files": publisher.files("metadata"), "phase": "metadata", "repository": "repo"}
        for source, digit in (("modelscope", "1"), ("huggingface", "2"))
    ]
    (publisher.REPORT / "metadata-first-uploads.json").write_text(json.dumps(first), encoding="utf-8")
    progress = [dict(first[0], revision="3" * 40)]
    (publisher.REPORT / "metadata-repair-progress.json").write_text(json.dumps(progress), encoding="utf-8")
    heads = {"modelscope": "3" * 40, "huggingface": "2" * 40}
    publisher.remote_head = lambda source, repository: heads[source]
    publisher.remote_url = lambda source, repository, revision, path: f"{source}:{revision}:{path}"
    publisher.remote_identity = lambda address: {"bytes": 1, "sha256": "x"}
    publisher.identity = lambda path: {"bytes": path.stat().st_size, "sha256": r.sha(path.read_bytes())}
    publisher.upload_folder = lambda source, repository, folder, message, parent: publisher.upload_calls.append(source) or "4" * 40
    publisher.expected_files = lambda phase: publisher.files(phase)
    publisher.binding = lambda: {"protocolSha256": "p", "receiptSha256": "r"}
    publisher.validate_downloads = lambda phase: None
    publisher.validate_browser = lambda: None
    (publisher.REPORT / "hub-README.md").write_bytes(b"root")
    publisher.remote_identity = lambda address: publisher.identity(publisher.REPORT / "hub-README.md") if address.endswith("README.md") else {"bytes": 1, "sha256": "x"}
    for row in first + progress:
        row.update(publisher.binding())
    (publisher.REPORT / "metadata-first-uploads.json").write_text(json.dumps(first), encoding="utf-8")
    (publisher.REPORT / "metadata-repair-progress.json").write_text(json.dumps(progress), encoding="utf-8")
    publisher.now = lambda: "now"
    publisher.REPOSITORY = "repo"
    publisher.upload_calls = []
    r.upload_repair(publisher)
    assert publisher.upload_calls == ["huggingface"]
    assert json.loads((publisher.REPORT / "metadata-first-uploads.json").read_text(encoding="utf-8")) == first
