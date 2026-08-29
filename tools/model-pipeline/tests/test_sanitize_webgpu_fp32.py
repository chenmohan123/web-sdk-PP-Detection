from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import onnx
import pytest
from onnx import TensorProto, helper, numpy_helper

from picodet.sanitize_webgpu_fp32 import POSITIONAL_NAMES, sanitize_webgpu_fp32


def _source_model(*, missing: str | None = None, wrong_shape: bool = False, extra_double: bool = False, cast_to: int = TensorProto.FLOAT) -> onnx.ModelProto:
    initializers = []
    for name in POSITIONAL_NAMES:
        if name == missing:
            continue
        shape = (624, 64) if wrong_shape and name == POSITIONAL_NAMES[0] else (625, 64)
        initializers.append(numpy_helper.from_array(np.zeros(shape, dtype=np.float64), name=name))
    if extra_double:
        initializers.append(numpy_helper.from_array(np.zeros((1,), dtype=np.float64), name="unexpected"))
    nodes = [
        helper.make_node("Concat", list(POSITIONAL_NAMES), ["cat_7"], axis=1, name="node_cat_7"),
        helper.make_node("Cast", ["cat_7"], ["_to_copy_4"], to=cast_to, name="node__to_copy_4"),
        helper.make_node("Identity", ["_to_copy_4"], ["output"], name="output_identity"),
    ]
    graph = helper.make_graph(
        nodes,
        "picodet-sanitize-test",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [625, 256])],
        initializers,
    )
    return helper.make_model(graph, opset_imports=[helper.make_opsetid("", 11)])


def _write(path: Path, model: onnx.ModelProto) -> None:
    path.write_bytes(model.SerializeToString(deterministic=True))


def test_sanitize_converts_only_known_initializers_and_is_reproducible(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    first = tmp_path / "first.onnx"
    second = tmp_path / "second.onnx"
    _write(source, _source_model())

    first_result = sanitize_webgpu_fp32(source, first)
    second_result = sanitize_webgpu_fp32(source, second)

    assert first.read_bytes() == second.read_bytes()
    assert first_result == {"bytes": first.stat().st_size, "sha256": hashlib.sha256(first.read_bytes()).hexdigest()}
    model = onnx.load(first, load_external_data=False)
    assert all(item.data_type == TensorProto.FLOAT for item in model.graph.initializer)
    assert not [item for item in model.graph.initializer if item.data_type == TensorProto.DOUBLE]


@pytest.mark.parametrize(
    "kwargs, pattern",
    [
        ({"missing": "sin"}, "ONNX checker|必须|恰好"),
        ({"wrong_shape": True}, "shape"),
        ({"extra_double": True}, "恰好"),
        ({"cast_to": TensorProto.FLOAT16}, "FLOAT"),
    ],
)
def test_sanitize_rejects_unknown_or_unsafe_graphs(tmp_path: Path, kwargs: dict[str, object], pattern: str) -> None:
    source = tmp_path / "source.onnx"
    target = tmp_path / "target.onnx"
    _write(source, _source_model(**kwargs))

    with pytest.raises(ValueError, match=pattern):
        sanitize_webgpu_fp32(source, target)

    assert not target.exists()


def test_sanitize_rejects_changed_concat_topology(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    target = tmp_path / "target.onnx"
    model = _source_model()
    model.graph.node[0].input[0] = "cat_7"
    _write(source, model)

    with pytest.raises(ValueError):
        sanitize_webgpu_fp32(source, target)

    assert not target.exists()
