import json
from pathlib import Path

import onnx
import pytest

from picodet.convert_fp16 import (
    DEFAULT_BLOCKED_NODES,
    DEFAULT_BLOCKED_OPS,
    build_conversion_plan,
    convert_fp16,
)


ROOT = Path(__file__).parents[3]
MODEL_PATH = ROOT / "models" / "pp-detection" / "picodet-l-320-fp32.onnx"


def test_picodet_conversion_plan_preserves_browser_sensitive_fp32_boundaries() -> None:
    model = onnx.load(MODEL_PATH, load_external_data=False)

    plan = build_conversion_plan(model)

    assert plan.blocked_ops == DEFAULT_BLOCKED_OPS == ("NonMaxSuppression", "Resize")
    assert plan.blocked_nodes == DEFAULT_BLOCKED_NODES == ("Cast_5",)


def test_picodet_converter_rejects_non_picodet_graph_before_writing_output(
    tmp_path: Path,
) -> None:
    source = tmp_path / "not-picodet.onnx"
    output = tmp_path / "fp16.onnx"
    onnx.save(onnx.ModelProto(), source)

    with pytest.raises(ValueError, match="PicoDet"):
        convert_fp16(source, output)

    assert not output.exists()


def test_picodet_converter_rejects_real_model_when_fixture_parity_fails(
    tmp_path: Path,
) -> None:
    output = tmp_path / "fp16.onnx"

    with pytest.raises(ValueError, match="parity"):
        convert_fp16(MODEL_PATH, output)

    assert not output.exists()


def test_fp16_rejection_report_is_bound_to_current_fp32_model() -> None:
    report_path = Path(__file__).parents[1] / "reports" / "1.0.1" / "fp16-cpu-rejection.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert report["status"] == "failed"
    assert report["reference"]["sha256"] == "0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1"
    assert len(report["fixtures"]) == 7
    assert all(fixture["pass"] is False for fixture in report["fixtures"])
