from __future__ import annotations

from pathlib import Path

import pytest

from picodet.inspect_onnx import inspect_onnx, validate_detection_outputs


def test_inspect_rejects_missing_onnx_artifact(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        inspect_onnx(tmp_path / "missing.onnx")


def test_inspect_requires_picodet_input_and_opset(tmp_path: Path) -> None:
    path = tmp_path / "invalid.onnx"
    path.write_bytes(b"not an onnx model")
    with pytest.raises((ValueError, RuntimeError)):
        inspect_onnx(path)

def test_detection_outputs_require_consumable_rank_and_last_dimension() -> None:
    assert validate_detection_outputs([{"name": "dets", "shape": [1, 100, 6], "dtype": "float32"}]) is None
    with pytest.raises(ValueError, match="输出"):
        validate_detection_outputs([{"name": "scalar", "shape": [], "dtype": "float32"}])


def test_inspect_accepts_pico_postprocessed_output_contract(tmp_path: Path) -> None:
    onnx = pytest.importorskip("onnx")
    import numpy as np

    image = onnx.helper.make_tensor_value_info("image", onnx.TensorProto.FLOAT, [1, 3, 320, 320])
    detections = onnx.helper.make_tensor_value_info("multiclass_nms3_0.tmp_0", onnx.TensorProto.FLOAT, [100, 6])
    count = onnx.helper.make_tensor_value_info("multiclass_nms3_0.tmp_2", onnx.TensorProto.INT32, [1])
    zero = onnx.helper.make_tensor("zero", onnx.TensorProto.FLOAT, [1], np.array([0], dtype=np.float32))
    graph = onnx.helper.make_graph(
        [
            onnx.helper.make_node("Constant", [], ["multiclass_nms3_0.tmp_0"], value=onnx.helper.make_tensor("d", onnx.TensorProto.FLOAT, [100, 6], np.zeros((100, 6), dtype=np.float32))),
            onnx.helper.make_node("Constant", [], ["multiclass_nms3_0.tmp_2"], value=onnx.helper.make_tensor("c", onnx.TensorProto.INT32, [1], [0])),
        ],
        "pico-contract",
        [image],
        [detections, count],
        [zero],
    )
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 11)])
    path = tmp_path / "pico.onnx"
    onnx.save(model, path)

    result = inspect_onnx(path)

    assert result["outputs"] == [
        {"name": "multiclass_nms3_0.tmp_0", "dtype": "float32", "shape": [100, 6]},
        {"name": "multiclass_nms3_0.tmp_2", "dtype": "int32", "shape": [1]},
    ]
