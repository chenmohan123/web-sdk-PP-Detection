from __future__ import annotations

import pytest

from picodet.quantize_int8 import build_report, validate_evidence


def test_int8_without_browser_and_accuracy_evidence_stays_labs() -> None:
    report = build_report(input_path="model.onnx", output_path="model.int8.onnx", calibration_images=["a.jpg"], evidence={})
    assert report["status"] == "labs"
    assert report["method"] == "static-qdq"


def test_int8_evidence_requires_all_runtime_gates() -> None:
    with pytest.raises(ValueError, match="证据"):
        validate_evidence({"python": True, "browserWasm": True})
