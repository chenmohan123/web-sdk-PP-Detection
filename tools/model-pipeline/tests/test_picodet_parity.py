from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from picodet.parity import compare_outputs, prepare_input


def test_prepare_input_uses_stretch_resize_and_paddles_normalization(tmp_path: Path) -> None:
    image_path = tmp_path / "fixture.png"
    Image.new("RGB", (2, 1), (255, 128, 0)).save(image_path)

    data, metadata = prepare_input(image_path, size=(4, 4))

    assert data.shape == (1, 3, 4, 4)
    assert data.dtype == np.float32
    assert metadata == {
        "width": 2,
        "height": 1,
        "resizedWidth": 4,
        "resizedHeight": 4,
        "resizeMode": "stretch",
        "rescaleFactor": 1 / 255,
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
    }
    assert np.allclose(data[0, :, 0, 0], [(1 - 0.485) / 0.229, (128 / 255 - 0.456) / 0.224, -0.406 / 0.225])


def test_compare_outputs_compares_detection_rows_and_does_not_use_bad_count() -> None:
    reference = {
        "multiclass_nms3_0.tmp_0": np.asarray(
            [[0, 0.9, 1, 2, 11, 12], [1, 0.8, 3, 4, 13, 14]], dtype=np.float32
        ),
        "multiclass_nms3_0.tmp_2": np.asarray([2125], dtype=np.int32),
    }
    candidate = {
        "multiclass_nms3_0.tmp_0": np.asarray(
            [[0, 0.9000001, 1.00001, 2, 11, 12], [1, 0.8, 3, 4, 13, 14]],
            dtype=np.float32,
        ),
        "multiclass_nms3_0.tmp_2": np.asarray([100], dtype=np.int32),
    }

    report = compare_outputs(reference, candidate)

    assert report["matrix"]["rowCount"] == {"reference": 2, "candidate": 2}
    assert report["matrix"]["classSequenceEqual"] is True
    assert report["matrix"]["maxCoordinateDeltaPixels"] <= 0.001
    assert report["matrix"]["maxScoreDelta"] <= 0.001
    assert report["matrix"]["pass"] is True
    assert report["count"]["status"] == "inconsistent_ignored"
    assert report["count"]["referenceValue"] == 2125
    assert report["count"]["candidateValue"] == 100
    assert report["pass"] is True


def test_compare_outputs_rejects_missing_detection_matrix() -> None:
    report = compare_outputs(
        {"count": np.asarray([1], dtype=np.int32)},
        {"count": np.asarray([1], dtype=np.int32)},
    )

    assert report["pass"] is False
    assert "检测矩阵" in report["reason"]


def test_committed_parity_report_preserves_historical_candidate_and_fixtures() -> None:
    report_path = Path(__file__).parents[1] / "reports" / "picodet-parity.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert report["status"] == "passed"
    assert report["model"]["candidate"] == {
        # 该报告记录 1.0.0 历史候选，当前模型路径由 manifest 单独管理。
        "path": "models/pp-detection/1.0.0/picodet-l-320-fp32.onnx",
        "bytes": 23219047,
        "sha256": "a7e1fbfe20f07fd7a7567811a4e2670df0595f0fecb885505d7d93466990e982",
        "input": {"name": "image", "shape": [1, 3, 320, 320], "dtype": "float32"},
        "opset": 11,
        "parameterCount": 5787988,
        "outputs": [
            {"name": "multiclass_nms3_0.tmp_0", "shape": [-1, 6], "dtype": "float32"},
            {"name": "multiclass_nms3_0.tmp_2", "shape": [1], "dtype": "int32"},
        ],
    }
    assert [fixture["path"] for fixture in report["fixtures"]] == [
        "tools/model-pipeline/fixtures/images/layout-demo.jpg",
        "tools/model-pipeline/fixtures/images/curved-document.jpg",
        "tools/model-pipeline/fixtures/images/image-layout.jpg",
    ]
    assert all(fixture["pass"] for fixture in report["fixtures"])
    assert report["countOutput"]["status"] == "inconsistent_ignored"
