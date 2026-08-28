from __future__ import annotations

import hashlib
import json
from pathlib import Path
import pytest

from picodet.build_manifest import build_manifest
from picodet.fetch_official import fetch
from picodet.sanitize_onnx import sanitize_postprocessed_model

ROOT = Path(__file__).parents[3]
MANIFEST = ROOT / "models" / "pp-detection" / "1.0.0" / "manifest.json"

def test_blocked_manifest_contains_no_fake_artifact_metadata() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert data["status"] == "labs/blocked"
    assert data["model"]["id"] == "pp-picodet-l-320"
    assert data["variants"] == []
    assert data["blocked"]["reason"]
    assert "placeholder" not in json.dumps(data, ensure_ascii=False).lower()

def test_manifest_builder_returns_blocked_without_artifacts(tmp_path: Path) -> None:
    result = build_manifest(artifact_dir=tmp_path, model_version="1.0.0", source_evidence=None)
    assert result["status"] == "labs/blocked"
    assert result["variants"] == []

def test_manifest_builder_hashes_real_artifact_only() -> None:
    artifact_dir = ROOT / "models" / "pp-detection" / "1.0.0"
    result = build_manifest(artifact_dir=artifact_dir, model_version="1.0.0", source_evidence=None)
    assert result["variants"] == []
    assert hashlib.sha256(b"placeholder").hexdigest() not in json.dumps(result)

def test_manifest_builder_rejects_fake_source_metadata(tmp_path: Path) -> None:
    artifact = tmp_path / "picodet-l-320-fp32.onnx"
    artifact.write_bytes(b"real test artifact")
    fake_sources = [
        {"kind": "fake", "repository": "x", "revision": "x", "path": "x", "downloadUrl": "not-url", "bytes": 0, "sha256": "bad"}
        for _ in range(3)
    ]
    with pytest.raises(ValueError, match="来源"):
        build_manifest(artifact_dir=tmp_path, model_version="1.0.0", source_evidence=fake_sources)

def test_manifest_builder_requires_three_distinct_sources(tmp_path: Path) -> None:
    artifact = tmp_path / "picodet-l-320-fp32.onnx"
    artifact.write_bytes(b"real test artifact")
    source = {"kind": "git-lfs", "repository": "x", "revision": "a" * 40, "path": "x", "downloadUrl": "https://example.com/model.onnx", "bytes": 1, "sha256": "a" * 64}
    with pytest.raises(ValueError, match="三类"):
        build_manifest(artifact_dir=tmp_path, model_version="1.0.0", source_evidence=[source, {**source}, {**source}])

def test_fetch_requires_immutable_revision_and_http_urls(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="revision"):
        fetch(revision="main", weights_url="https://example.com/model", config_url="https://example.com/config", output_dir=tmp_path)
    with pytest.raises(ValueError, match="URL"):
        fetch(revision="a" * 40, weights_url="file:///model", config_url="https://example.com/config", output_dir=tmp_path)


def test_sanitize_postprocessed_model_keeps_only_static_image_input(tmp_path: Path) -> None:
    onnx = pytest.importorskip("onnx")
    import numpy as np

    image = onnx.helper.make_tensor_value_info("image", onnx.TensorProto.FLOAT, [None, 3, 320, 320])
    scale = onnx.helper.make_tensor_value_info("scale_factor", onnx.TensorProto.FLOAT, [1, 2])
    weight_input = onnx.helper.make_tensor_value_info("weight", onnx.TensorProto.FLOAT, [1])
    weight = onnx.helper.make_tensor("weight", onnx.TensorProto.FLOAT, [1], np.array([1], dtype=np.float32))
    output = onnx.helper.make_tensor_value_info("detections", onnx.TensorProto.FLOAT, [2125, 6])
    count = onnx.helper.make_tensor_value_info("count", onnx.TensorProto.INT32, [2125])
    graph = onnx.helper.make_graph(
        [
            onnx.helper.make_node("Add", ["image", "weight"], ["detections"]),
            onnx.helper.make_node(
                "Constant",
                [],
                ["count"],
                value=onnx.helper.make_tensor("count_value", onnx.TensorProto.INT32, [1], [1]),
            ),
        ],
        "pico-test",
        [image, scale, weight_input],
        [output, count],
        [weight],
    )
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 11)])
    source = tmp_path / "source.onnx"
    target = tmp_path / "clean.onnx"
    onnx.save(model, source)

    report = sanitize_postprocessed_model(source, target)
    cleaned = onnx.load(target, load_external_data=False)

    assert [item.name for item in cleaned.graph.input] == ["image"]
    image_shape = [dim.dim_value for dim in cleaned.graph.input[0].type.tensor_type.shape.dim]
    assert image_shape == [1, 3, 320, 320]
    scale_initializer = next(item for item in cleaned.graph.initializer if item.name == "scale_factor")
    assert onnx.numpy_helper.to_array(scale_initializer).tolist() == [[1.0, 1.0]]
    assert cleaned.graph.output[0].type.tensor_type.shape.dim[0].dim_param == "num_detections"
    assert cleaned.graph.output[0].type.tensor_type.shape.dim[1].dim_value == 6
    assert [dim.dim_value for dim in cleaned.graph.output[1].type.tensor_type.shape.dim] == [1]
    assert report["removedGraphInputs"] == ["scale_factor", "weight"]


def test_sanitize_postprocessed_model_marks_detection_rows_dynamic(tmp_path: Path) -> None:
    onnx = pytest.importorskip("onnx")
    import numpy as np

    image = onnx.helper.make_tensor_value_info("image", onnx.TensorProto.FLOAT, [None, 3, 320, 320])
    output = onnx.helper.make_tensor_value_info("detections", onnx.TensorProto.FLOAT, [2125, 6])
    graph = onnx.helper.make_graph(
        [
            onnx.helper.make_node(
                "Constant",
                [],
                ["detections"],
                value=onnx.helper.make_tensor(
                    "d", onnx.TensorProto.FLOAT, [2, 6], np.zeros((2, 6), dtype=np.float32)
                ),
            )
        ],
        "pico-dynamic-test",
        [image],
        [output],
    )
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 11)])
    source = tmp_path / "source.onnx"
    target = tmp_path / "clean.onnx"
    onnx.save(model, source)

    sanitize_postprocessed_model(source, target)
    cleaned = onnx.load(target, load_external_data=False)
    dimension = cleaned.graph.output[0].type.tensor_type.shape.dim[0]

    assert dimension.dim_param == "num_detections"
    assert dimension.dim_value == 0
