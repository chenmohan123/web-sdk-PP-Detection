from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def _shape(value) -> list[int | str]:
    return [dimension.dim_param or dimension.dim_value for dimension in value.type.tensor_type.shape.dim]


def repair_onnx(source: Path, output: Path) -> dict[str, object]:
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    model = onnx.load(source)
    opsets = [item.version for item in model.opset_import if item.domain in {"", "ai.onnx"}]
    if opsets != [11]:
        raise ValueError(f"只接受 ONNX opset 11，实际为 {opsets}")
    inputs = {item.name: item for item in model.graph.input}
    if set(inputs) != {"image", "scale_factor"}:
        raise ValueError("输入必须恰好为 image 和 scale_factor")
    if inputs["image"].type.tensor_type.elem_type != TensorProto.FLOAT or _shape(inputs["image"])[1:] != [3, 640, 640]:
        raise ValueError("image 必须是 float32 [batch,3,640,640]")
    if inputs["scale_factor"].type.tensor_type.elem_type != TensorProto.FLOAT or _shape(inputs["scale_factor"])[1:] != [2]:
        raise ValueError("scale_factor 必须是 float32 [batch,2]")

    nodes = {node.name: node for node in model.graph.node}
    non_empty_names = [node.name for node in model.graph.node if node.name]
    if len(non_empty_names) != len(set(non_empty_names)):
        raise ValueError("ONNX 图包含重复节点名，拒绝修复未知图")
    expected = {
        "NonMaxSuppression.0": ("NonMaxSuppression", None),
        "Gather.0": ("Gather", "nms.selected_index.0"),
        "Gather.2": ("Gather", "nms.selected_index.0"),
        "Squeeze.3": ("Squeeze", "Gather.1"),
        "Squeeze.5": ("Squeeze", "Gather.3"),
    }
    for name, (op_type, first_input) in expected.items():
        node = nodes.get(name)
        if node is None or node.op_type != op_type:
            raise ValueError(f"缺少预期节点 {name} ({op_type})")
        if first_input is not None and (not node.input or node.input[0] != first_input):
            raise ValueError(f"{name} 未消费预期张量 {first_input}")
    nms = nodes["NonMaxSuppression.0"]
    if list(nms.output) != ["nms.selected_index.0"]:
        raise ValueError("NonMaxSuppression.0 输出拓扑不匹配")
    if list(nodes["Gather.0"].output) != ["Gather.1"] or list(nodes["Gather.2"].output) != ["Gather.3"]:
        raise ValueError("NMS class/box 列 Gather 输出拓扑不匹配")

    initializers = {item.name: numpy_helper.to_array(item) for item in model.graph.initializer}
    constant_outputs = {}
    for node in model.graph.node:
        if node.op_type == "Constant" and len(node.output) == 1:
            value = next((attribute.t for attribute in node.attribute if attribute.name == "value"), None)
            if value is not None:
                constant_outputs[node.output[0]] = numpy_helper.to_array(value)

    def validate_gather_column(name: str, expected_column: int, label: str) -> None:
        node = nodes[name]
        axes = [attribute.i for attribute in node.attribute if attribute.name == "axis"]
        if axes != [1] or len(node.input) != 2:
            raise ValueError(f"{name} 必须沿 axis=1 读取 NMS {label} 列")
        column = initializers.get(node.input[1], constant_outputs.get(node.input[1]))
        if column is None or np.asarray(column).tolist() != [expected_column]:
            raise ValueError(f"{name} 的 NMS {label} 列索引必须为 {expected_column}")

    validate_gather_column("Gather.0", 1, "class")
    validate_gather_column("Gather.2", 2, "box")
    for name in ("Squeeze.3", "Squeeze.5"):
        if nodes[name].attribute:
            raise ValueError(f"{name} 已声明 axes 或其他属性，拒绝修改未知拓扑")

    image_shape = inputs["image"].type.tensor_type.shape.dim
    image_shape[0].ClearField("dim_param")
    image_shape[0].dim_value = 1
    scale_input = inputs["scale_factor"]
    model.graph.input.remove(scale_input)
    if any(item.name == "scale_factor" for item in model.graph.initializer):
        raise ValueError("scale_factor 已存在 initializer，拒绝覆盖未知图")
    model.graph.initializer.append(numpy_helper.from_array(np.ones((1, 2), dtype=np.float32), name="scale_factor"))
    for name in ("Squeeze.3", "Squeeze.5"):
        node = nodes[name]
        del node.attribute[:]
        node.attribute.append(helper.make_attribute("axes", [1]))

    onnx.checker.check_model(model)
    output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, output)
    return {
        "source": str(source),
        "output": str(output),
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "outputSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "changes": ["image_batch=1", "scale_factor=initializer[[1,1]]", "Squeeze.3.axes=[1]", "Squeeze.5.axes=[1]"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="严格修复 PP-YOLOE+ S 的 ONNX NMS 后处理图")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = repair_onnx(args.input, args.output)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        print(f"ONNX 修复失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
