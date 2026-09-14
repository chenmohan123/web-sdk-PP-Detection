from pathlib import Path

import pytest

from picodet.sanitize_onnx import sanitize_postprocessed_model
from picodet.inspect_onnx import inspect_onnx


@pytest.mark.parametrize("size", (320, 416, 640))
def test_size_contract_rejects_or_accepts_explicit_sizes(tmp_path: Path, size: int) -> None:
    onnx = pytest.importorskip("onnx")
    import numpy as np

    image = onnx.helper.make_tensor_value_info("image", onnx.TensorProto.FLOAT, [None, 3, size, size])
    output = onnx.helper.make_tensor_value_info("detections", onnx.TensorProto.FLOAT, [2, 6])
    node = onnx.helper.make_node("Constant", [], ["detections"], value=onnx.helper.make_tensor("d", onnx.TensorProto.FLOAT, [2, 6], np.zeros((2, 6), dtype=np.float32)))
    model = onnx.helper.make_model(onnx.helper.make_graph([node], "pico", [image], [output]), opset_imports=[onnx.helper.make_opsetid("", 11)])
    source, target = tmp_path / "source.onnx", tmp_path / "target.onnx"
    onnx.save(model, source)
    report = sanitize_postprocessed_model(source, target, input_size=size)
    assert report["imageShape"] == [1, 3, size, size]


@pytest.mark.parametrize("size", (0, 321, 512, "416", None))
def test_size_contract_rejects_unknown_sizes(tmp_path: Path, size) -> None:
    with pytest.raises(ValueError, match="320、416 或 640"):
        sanitize_postprocessed_model(tmp_path / "missing.onnx", tmp_path / "out.onnx", input_size=size)


def test_default_size_remains_320() -> None:
    with pytest.raises(FileNotFoundError):
        inspect_onnx(Path("missing.onnx"))
