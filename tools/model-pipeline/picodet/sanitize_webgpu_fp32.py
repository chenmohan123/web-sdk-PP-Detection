"""清理 PicoDet FP32 ONNX 中已知的 DOUBLE 位置编码路径。"""

from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper

POSITIONAL_NAMES = ("sin", "cos", "sin_1", "cos_1")
POSITIONAL_SHAPE = [625, 64]


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


def sanitize_webgpu_fp32(source: Path, target: Path) -> dict[str, int | str]:
    """只转换四个已知位置初始化器，失败时不创建目标文件。"""
    source = source.resolve()
    target = target.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    model = onnx.load(source, load_external_data=False)
    _validate_source(model)

    for index, value in enumerate(model.graph.initializer):
        if value.name in POSITIONAL_NAMES:
            converted = numpy_helper.from_array(numpy_helper.to_array(value).astype(np.float32), name=value.name)
            model.graph.initializer[index].CopyFrom(converted)

    inferred = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    onnx.checker.check_model(inferred)
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


def main() -> None:
    parser = argparse.ArgumentParser(description="清理 PicoDet FP32 WebGPU ONNX")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    args = parser.parse_args()
    result = sanitize_webgpu_fp32(args.source, args.target)
    print(f"{args.target}: {result['bytes']} bytes sha256={result['sha256']}")


if __name__ == "__main__":
    main()
