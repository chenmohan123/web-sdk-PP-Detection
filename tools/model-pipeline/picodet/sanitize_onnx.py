from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


IMAGE_NAME = "image"
SCALE_FACTOR_NAME = "scale_factor"
IMAGE_SHAPE = (1, 3, 320, 320)
DETECTION_OUTPUT_SHAPE = (100, 6)
COUNT_OUTPUT_SHAPE = (1,)


def _require_onnx() -> Any:
    try:
        import onnx
    except ImportError as exc:
        raise RuntimeError("清理 ONNX 需要 onnx，请安装 tools/model-pipeline/requirements-model.lock") from exc
    return onnx


def _set_static_shape(value_info: Any, shape: tuple[int, ...]) -> None:
    dimensions = value_info.type.tensor_type.shape.dim
    del dimensions[:]
    for dimension in shape:
        dimensions.add().dim_value = dimension


def _set_dynamic_detection_shape(value_info: Any) -> None:
    dimensions = value_info.type.tensor_type.shape.dim
    del dimensions[:]
    dimensions.add().dim_param = "num_detections"
    dimensions.add().dim_value = 6


def _fix_output_shapes(onnx: Any, graph: Any) -> dict[str, list[int]]:
    fixed: dict[str, list[int]] = {}
    detection_names: list[str] = []
    count_names: list[str] = []
    for output in graph.output:
        tensor = output.type.tensor_type
        current = [dimension.dim_value for dimension in tensor.shape.dim]
        if tensor.elem_type == onnx.TensorProto.FLOAT and len(current) == 2 and current[-1] == 6:
            _set_dynamic_detection_shape(output)
            detection_names.append(output.name)
            fixed[output.name] = [-1, DETECTION_OUTPUT_SHAPE[1]]
        elif tensor.elem_type in (onnx.TensorProto.INT32, onnx.TensorProto.INT64) and len(current) == 1:
            _set_static_shape(output, COUNT_OUTPUT_SHAPE)
            count_names.append(output.name)
            fixed[output.name] = list(COUNT_OUTPUT_SHAPE)
    if len(detection_names) != 1:
        raise ValueError("PicoDet 后处理 ONNX 必须恰好有一个 float32 [N, 6] 检测输出")
    if len(count_names) > 1:
        raise ValueError("PicoDet 后处理 ONNX 的数量输出不得超过一个")
    return fixed


def sanitize_postprocessed_model(
    source: Path,
    target: Path,
    *,
    image_name: str = IMAGE_NAME,
    scale_factor_name: str = SCALE_FACTOR_NAME,
) -> dict[str, Any]:
    """将 PaddleDetection 后处理导出的 ONNX 固定为 SDK 可直接调用的单输入图。

    Paddle2ONNX 可能把 initializer 同时暴露为 graph input。此函数只移除
    能在 initializer 中找到的输入，并把后处理使用的 scale_factor 固定为 1，
    不会默默丢弃未知的运行时输入。
    """
    onnx = _require_onnx()
    source = source.resolve()
    target = target.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    model = onnx.load(source, load_external_data=False)
    graph = model.graph
    graph_inputs = {item.name: item for item in graph.input}
    image_input = graph_inputs.get(image_name)
    if image_input is None:
        raise ValueError(f"ONNX 缺少 {image_name} 输入")
    if image_input.type.tensor_type.elem_type != onnx.TensorProto.FLOAT:
        raise ValueError(f"{image_name} 输入必须为 float32")
    _set_static_shape(image_input, IMAGE_SHAPE)

    initializer_names = {item.name for item in graph.initializer}
    removed_inputs: list[str] = []
    kept_inputs = []
    for value_info in graph.input:
        name = value_info.name
        if name == image_name:
            kept_inputs.append(value_info)
        elif name == scale_factor_name or name in initializer_names:
            removed_inputs.append(name)
        else:
            raise ValueError(f"不能安全移除未知的运行时输入: {name}")
    del graph.input[:]
    graph.input.extend(kept_inputs)

    from onnx import numpy_helper
    import numpy as np

    for index in range(len(graph.initializer) - 1, -1, -1):
        if graph.initializer[index].name == scale_factor_name:
            del graph.initializer[index]
    graph.initializer.append(
        numpy_helper.from_array(np.array([[1.0, 1.0]], dtype=np.float32), name=scale_factor_name)
    )
    fixed_outputs = _fix_output_shapes(onnx, graph)

    metadata = {item.key: item.value for item in model.metadata_props}
    metadata["pp_detection.derived_from"] = source.name
    metadata["pp_detection.sanitizer"] = "sanitize_postprocessed_model@1"
    del model.metadata_props[:]
    for key, value in sorted(metadata.items()):
        entry = model.metadata_props.add()
        entry.key = key
        entry.value = value

    onnx.checker.check_model(model)
    target.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, target)
    return {
        "source": str(source),
        "target": str(target),
        "imageInput": image_name,
        "imageShape": list(IMAGE_SHAPE),
        "fixedInputs": {scale_factor_name: [[1.0, 1.0]]},
        "removedGraphInputs": removed_inputs,
        "initializerCount": len(graph.initializer),
        "fixedOutputs": fixed_outputs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="清理 PaddleDetection PicoDet 后处理 ONNX")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = sanitize_postprocessed_model(args.input, args.output)
    except Exception as exc:
        print(f"清理失败: {exc}")
        return 1
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
