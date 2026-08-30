from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import onnx
import pytest
from onnx import TensorProto, helper, numpy_helper

from picodet.sanitize_webgpu_fp32 import (
    POSITIONAL_NAMES,
    sanitize_picodet_webgpu_fp32,
    sanitize_webgpu_fp32,
)


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


def test_sanitize_converts_picodet_webgpu_matmul_weight_to_rank_two(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    target = tmp_path / "target.onnx"
    model = _picodet_matmul_model()
    _write(source, model)

    sanitize_picodet_webgpu_fp32(source, target)

    cleaned = onnx.load(target, load_external_data=False)
    weight = next(item for item in cleaned.graph.initializer if item.name == "auto_4_")
    assert list(weight.dims) == [8, 1]
    assert [node.name for node in cleaned.graph.node if node.op_type == "MatMul"] == [
        "MatMul_0",
        "MatMul_1",
        "MatMul_2",
        "MatMul_3",
    ]
    assert {output.name for output in cleaned.graph.output} == {
        "multiclass_nms3_0.tmp_0",
        "multiclass_nms3_0.tmp_2",
    }
    assert [item.name for item in cleaned.graph.input] == ["image"]


def _picodet_matmul_model() -> onnx.ModelProto:
    initializers = [numpy_helper.from_array(np.arange(8, dtype=np.float32), name="auto_4_")]
    inputs = [helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, 320, 320])]
    nodes = [
        helper.make_node(
            "Constant",
            [],
            [f"softmax_{index}.tmp_0"],
            value=numpy_helper.from_array(np.zeros((size, 8), dtype=np.float32)),
            name=f"softmax_{index}_constant",
        )
        for index, size in enumerate((6400, 1600, 400, 100))
    ]
    nodes.extend([
        helper.make_node(
            "MatMul",
            [f"softmax_{index}.tmp_0", "auto_4_"],
            [f"linear_{index}.tmp_0"],
            name=f"MatMul_{index}",
        )
        for index in range(4)
    ])
    nodes.extend([
        helper.make_node(
            "Constant",
            [],
            ["multiclass_nms3_0.tmp_0"],
            value=numpy_helper.from_array(np.empty((0, 6), dtype=np.float32)),
            name="multiclass_nms3_0_constant",
        ),
        helper.make_node(
            "Constant",
            [],
            ["multiclass_nms3_0.tmp_2"],
            value=numpy_helper.from_array(np.array([0], dtype=np.int64)),
            name="multiclass_nms3_0_count_constant",
        ),
    ])
    value_info = [
        helper.make_tensor_value_info(f"softmax_{index}.tmp_0", TensorProto.FLOAT, [size, 8])
        for index, size in enumerate((6400, 1600, 400, 100))
    ]
    value_info.extend(
        helper.make_tensor_value_info(f"linear_{index}.tmp_0", TensorProto.FLOAT, [size, 1])
        for index, size in enumerate((6400, 1600, 400, 100))
    )
    outputs = [
        helper.make_tensor_value_info("multiclass_nms3_0.tmp_0", TensorProto.FLOAT, [0, 6]),
        helper.make_tensor_value_info("multiclass_nms3_0.tmp_2", TensorProto.INT64, [1]),
    ]
    return helper.make_model(
        helper.make_graph(
            nodes,
            "picodet-webgpu-matmul-boundary",
            inputs,
            outputs,
            initializers,
            value_info=value_info,
        ),
        opset_imports=[helper.make_opsetid("", 11)],
    )


@pytest.mark.parametrize("mutation", ["weight", "topology", "shape"])
def test_picodet_sanitizer_rejects_unsafe_matmul_boundary(
    tmp_path: Path, mutation: str
) -> None:
    source = tmp_path / "source.onnx"
    target = tmp_path / "target.onnx"
    model = _picodet_matmul_model()
    if mutation == "weight":
        model.graph.initializer[0].CopyFrom(
            numpy_helper.from_array(np.zeros((7,), dtype=np.float32), name="auto_4_")
        )
    elif mutation == "topology":
        next(node for node in model.graph.node if node.name == "MatMul_0").input[0] = "unexpected_input"
    else:
        model.graph.value_info[0].type.tensor_type.shape.dim[0].dim_value = 1
    _write(source, model)

    with pytest.raises(ValueError):
        sanitize_picodet_webgpu_fp32(source, target)

    assert not target.exists()


@pytest.mark.parametrize("mutation", ["missing_image", "wrong_image_shape", "missing_detection_output", "wrong_detection_dtype"])
def test_picodet_sanitizer_rejects_invalid_io_contract(
    tmp_path: Path, mutation: str
) -> None:
    source = tmp_path / "source.onnx"
    target = tmp_path / "target.onnx"
    model = _picodet_matmul_model()
    if mutation == "missing_image":
        del model.graph.input[:]
    elif mutation == "wrong_image_shape":
        model.graph.input[0].type.tensor_type.shape.dim[2].dim_value = 224
    elif mutation == "missing_detection_output":
        del model.graph.output[0]
    else:
        model.graph.output[0].type.tensor_type.elem_type = TensorProto.INT64
    _write(source, model)

    with pytest.raises(ValueError):
        sanitize_picodet_webgpu_fp32(source, target)

    assert not target.exists()
