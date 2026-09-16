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
