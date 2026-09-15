import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("prepare", HERE / "prepare.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def test_candidate_manifest_uses_local_custom_source():
    base = json.loads((prepare.ROOT / "models/pp-detection/picodet-xs-320/manifest.json").read_text(encoding="utf-8"))
    manifest = prepare.manifest_for(base, "picodet-xs-320", "fp16", "candidate.onnx", 123, "a" * 64,
                                    {"opset": 11, "parameterCount": 703102})
    variant = manifest["variants"][0]
    assert manifest["defaultSource"] == "custom"
    assert len(manifest["variants"]) == 1
    assert variant["sources"] == [{
        "kind": "custom", "repository": "local/picodet-series-precision-evaluation",
        "revision": "a" * 64, "path": "candidate.onnx",
        "downloadUrl": "http://127.0.0.1:4173/candidate.onnx", "bytes": 123, "sha256": "a" * 64,
    }]


def test_reusable_candidate_rejects_wrong_configuration(tmp_path):
    output = tmp_path / "x.onnx"
    output.write_bytes(b"candidate")
    size, sha = prepare.digest(output)
    report = tmp_path / "x.conversion.json"
    report.write_text(json.dumps({"key": "x", "precision": "fp16", "sourceSha256": "b" * 64,
                                  "sourceBytes": 10, "configuration": {"blockedNodes": []},
                                  "candidate": {"candidateBytes": size, "candidateSha256": sha}}))
    assert prepare.is_reusable(report, output, key="x", precision="fp16",
                               source_bytes=10, source_sha="b" * 64,
                               configuration={"blockedNodes": []})
    result = prepare.is_reusable(report, output, key="x", precision="fp16",
                                   source_bytes=10, source_sha="b" * 64,
                                   configuration={"blockedNodes": ["Cast_5"]})
    assert not result
