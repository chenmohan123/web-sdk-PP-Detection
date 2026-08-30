"""清理 PicoDet FP32 ONNX 中已知的 DOUBLE 位置编码路径。"""

from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
from tempfile import TemporaryDirectory
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper

POSITIONAL_NAMES = ("sin", "cos", "sin_1", "cos_1")
POSITIONAL_SHAPE = [625, 64]
MATMUL_NAMES = ("MatMul_0", "MatMul_1", "MatMul_2", "MatMul_3")
MATMUL_WEIGHT_NAME = "auto_4_"
IMAGE_NAME = "image"
IMAGE_SHAPE = [1, 3, 320, 320]
DETECTION_OUTPUT_NAME = "multiclass_nms3_0.tmp_0"
COUNT_OUTPUT_NAME = "multiclass_nms3_0.tmp_2"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _single_node(model: onnx.ModelProto, name: str) -> onnx.NodeProto:
    nodes = [node for node in model.graph.node if node.name == name]
    if len(nodes) != 1:
        raise ValueError(f"必须恰好存在一个 {name} 节点")
    return nodes[0]


def _validate_source(model: onnx.ModelProto) -> None:
    try:
        onnx.checker.check_model(model)
    except Exception as exc:
        raise ValueError("ONNX checker 校验失败") from exc
    doubles = {item.name: item for item in model.graph.initializer if item.data_type == TensorProto.DOUBLE}
    if set(doubles) != set(POSITIONAL_NAMES):
        raise ValueError(f"必须恰好存在 {list(POSITIONAL_NAMES)} 四个 DOUBLE 初始化器")
    for name, value in doubles.items():
        if list(value.dims) != POSITIONAL_SHAPE:
            raise ValueError(f"{name} 的 shape 必须是 {POSITIONAL_SHAPE}")

    concat = _single_node(model, "node_cat_7")
    axis = next((attribute.i for attribute in concat.attribute if attribute.name == "axis"), None)
    if concat.op_type != "Concat" or list(concat.input) != list(POSITIONAL_NAMES) or list(concat.output) != ["cat_7"] or axis != 1:
        raise ValueError("node_cat_7 必须按固定顺序在 axis=1 拼接四个位置初始化器")

    cast = _single_node(model, "node__to_copy_4")
    cast_to = next((attribute.i for attribute in cast.attribute if attribute.name == "to"), None)
    if cast.op_type != "Cast" or list(cast.input) != ["cat_7"] or list(cast.output) != ["_to_copy_4"] or cast_to != TensorProto.FLOAT:
        raise ValueError("node__to_copy_4 必须将 cat_7 Cast 为 FLOAT")


def _double_names(model: onnx.ModelProto) -> set[str]:
    names = {
        item.name
        for item in [*model.graph.input, *model.graph.output, *model.graph.value_info]
        if item.type.tensor_type.elem_type == TensorProto.DOUBLE
    }
    names.update(item.name for item in model.graph.initializer if item.data_type == TensorProto.DOUBLE)
    return names


def _validate_picodet_matmul_topology(model: onnx.ModelProto) -> onnx.TensorProto:
    nodes = [node for node in model.graph.node if node.op_type == "MatMul"]
    if [node.name for node in nodes] != list(MATMUL_NAMES):
        raise ValueError("PicoDet WebGPU 清理要求恰好存在 MatMul_0..MatMul_3 四个 MatMul 节点")
    for index, node in enumerate(nodes):
        expected_inputs = [f"softmax_{index}.tmp_0", MATMUL_WEIGHT_NAME]
        expected_outputs = [f"linear_{index}.tmp_0"]
        if list(node.input) != expected_inputs or list(node.output) != expected_outputs:
            raise ValueError(f"{node.name} 的 MatMul 拓扑与 PicoDet WebGPU 兼容模式不匹配")
    weight = next(
        (item for item in model.graph.initializer if item.name == MATMUL_WEIGHT_NAME),
        None,
    )
    if weight is None:
        raise ValueError(f"PicoDet WebGPU 清理缺少 {MATMUL_WEIGHT_NAME} 初始化器")
    if weight.data_type != TensorProto.FLOAT or list(weight.dims) not in ([8], [8, 1]):
        raise ValueError(f"{MATMUL_WEIGHT_NAME} 必须是 float32 [8] 或 [8, 1] 初始化器")
    return weight


def _validate_picodet_io_contract(model: onnx.ModelProto) -> None:
    inputs = list(model.graph.input)
    if len(inputs) != 1 or inputs[0].name != IMAGE_NAME:
        raise ValueError("PicoDet WebGPU 清理要求唯一的 image 输入")
    image = inputs[0]
    tensor = image.type.tensor_type
    if tensor.elem_type != TensorProto.FLOAT:
        raise ValueError("PicoDet image 输入必须为 float32")
    image_shape = [dimension.dim_value for dimension in tensor.shape.dim]
    if image_shape != IMAGE_SHAPE:
        raise ValueError(f"PicoDet image 输入 shape 必须为 {IMAGE_SHAPE}，实际为 {image_shape}")

    outputs = {output.name: output for output in model.graph.output}
    expected_outputs = {DETECTION_OUTPUT_NAME, COUNT_OUTPUT_NAME}
    if set(outputs) != expected_outputs:
        raise ValueError(
            "PicoDet WebGPU 清理要求 multiclass_nms3_0.tmp_0 和 multiclass_nms3_0.tmp_2 两个输出"
        )
    detection = outputs[DETECTION_OUTPUT_NAME].type.tensor_type
    detection_shape = [dimension.dim_value for dimension in detection.shape.dim]
    if detection.elem_type != TensorProto.FLOAT or len(detection_shape) != 2 or detection_shape[-1] != 6:
        raise ValueError("PicoDet 检测输出必须为 float32 [N, 6]")
    count = outputs[COUNT_OUTPUT_NAME].type.tensor_type
    count_shape = [dimension.dim_value for dimension in count.shape.dim]
    if count.elem_type not in (TensorProto.INT32, TensorProto.INT64) or count_shape != [1]:
        raise ValueError("PicoDet 数量输出必须为 int32/int64 [1]")


def _convert_picodet_matmul_weight(model: onnx.ModelProto) -> None:
    weight = _validate_picodet_matmul_topology(model)
    if list(weight.dims) == [8, 1]:
        return
    converted = numpy_helper.from_array(
        numpy_helper.to_array(weight).reshape(8, 1), name=MATMUL_WEIGHT_NAME
    )
    weight.CopyFrom(converted)


def _validate_picodet_matmul_shapes(model: onnx.ModelProto) -> None:
    value_info = {
        item.name: item
        for item in [*model.graph.input, *model.graph.value_info, *model.graph.output]
    }
    expected_sizes = (6400, 1600, 400, 100)
    for index, size in enumerate(expected_sizes):
        input_name = f"softmax_{index}.tmp_0"
        input_value = value_info.get(input_name)
        if input_value is None:
            raise ValueError(f"{input_name} 缺少 shape inference 结果")
        input_shape = [
            dimension.dim_value for dimension in input_value.type.tensor_type.shape.dim
        ]
        if input_shape != [size, 8]:
            raise ValueError(
                f"{input_name} 的 WebGPU 兼容 shape 必须为 [{size}, 8]，实际为 {input_shape}"
            )
        name = f"linear_{index}.tmp_0"
        value = value_info.get(name)
        if value is None:
            raise ValueError(f"{name} 缺少 shape inference 结果")
        shape = [dimension.dim_value for dimension in value.type.tensor_type.shape.dim]
        if shape != [size, 1]:
            raise ValueError(f"{name} 的 WebGPU 兼容 shape 必须为 [{size}, 1]，实际为 {shape}")


def _sanitize_webgpu_fp32(
    source: Path,
    target: Path,
    *,
    fix_picodet_matmul: bool,
    require_positional_constants: bool,
) -> dict[str, int | str]:
    """只转换四个已知位置初始化器，失败时不创建目标文件。"""
    source = source.resolve()
    target = target.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    model = onnx.load(source, load_external_data=False)
    if fix_picodet_matmul and any(
        value.name == "image" for value in model.graph.input
    ) and any(value.name != "image" for value in model.graph.input):
        try:
            from .sanitize_onnx import sanitize_postprocessed_model
        except ImportError:
            from sanitize_onnx import sanitize_postprocessed_model

        with TemporaryDirectory(prefix="picodet-webgpu-normalize-") as temporary:
            normalized = Path(temporary) / "normalized.onnx"
            sanitize_postprocessed_model(source, normalized)
            model = onnx.load(normalized, load_external_data=False)
    if require_positional_constants:
        _validate_source(model)
    elif any(item.data_type == TensorProto.DOUBLE for item in model.graph.initializer):
        _validate_source(model)
    if fix_picodet_matmul:
        _validate_picodet_io_contract(model)
        _convert_picodet_matmul_weight(model)

    for index, value in enumerate(model.graph.initializer):
        if value.name in POSITIONAL_NAMES:
            converted = numpy_helper.from_array(numpy_helper.to_array(value).astype(np.float32), name=value.name)
            model.graph.initializer[index].CopyFrom(converted)

    inferred = onnx.shape_inference.infer_shapes(
        model, strict_mode=not fix_picodet_matmul
    )
    onnx.checker.check_model(inferred)
    if fix_picodet_matmul:
        _validate_picodet_matmul_shapes(inferred)
    remaining = _double_names(inferred)
    if remaining:
        raise ValueError(f"清理后的图仍包含 DOUBLE 值: {sorted(remaining)}")

    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(inferred.SerializeToString(deterministic=True))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, target)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise
    return {"bytes": target.stat().st_size, "sha256": sha256_file(target)}


def sanitize_webgpu_fp32(source: Path, target: Path) -> dict[str, int | str]:
    """只清理位置编码 DOUBLE，保留通用 WebGPU 清理行为。"""
    return _sanitize_webgpu_fp32(
        source,
        target,
        fix_picodet_matmul=False,
        require_positional_constants=True,
    )


def sanitize_picodet_webgpu_fp32(source: Path, target: Path) -> dict[str, int | str]:
    """清理 PicoDet 位置编码并规避 ORT WebGPU 的 2D×1D MatMul 限制。"""
    return _sanitize_webgpu_fp32(
        source,
        target,
        fix_picodet_matmul=True,
        require_positional_constants=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="清理 PicoDet FP32 WebGPU ONNX")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    args = parser.parse_args()
    result = sanitize_picodet_webgpu_fp32(args.source, args.target)
    print(f"{args.target}: {result['bytes']} bytes sha256={result['sha256']}")


if __name__ == "__main__":
    main()
