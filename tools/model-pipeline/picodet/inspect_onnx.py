from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

EXPECTED_INPUT = {"name": "image", "shape": [1, 3, 320, 320], "dtype": "float32"}
EXPECTED_OPSET = 11


def validate_detection_outputs(outputs: list[dict[str, Any]]) -> None:
    """验证输出至少包含可供检测后处理解析的张量。"""
    detection_outputs = []
    for output in outputs:
        shape = output.get("shape", [])
        name = str(output.get("name", "")).lower()
        if len(shape) >= 2 and shape[-1] in {6, 7, "?"}:
            detection_outputs.append(output)
        elif len(shape) >= 2 and any(token in name for token in ("bbox", "box", "nms", "detect")):
            detection_outputs.append(output)
    if len(detection_outputs) == 1:
        return
    raise ValueError("PicoDet 输出必须是至少二维的检测张量，并可解析边界框、类别和分数")

def _dtype_name(onnx, elem_type: int) -> str:
    mapping = {onnx.TensorProto.FLOAT: "float32", onnx.TensorProto.FLOAT16: "float16", onnx.TensorProto.INT64: "int64", onnx.TensorProto.INT32: "int32"}
    return mapping.get(elem_type, f"onnx:{elem_type}")

def inspect_onnx(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    try:
        import onnx
    except ImportError as exc:
        raise RuntimeError("缺少 onnx，请安装 tools/model-pipeline/requirements-model.lock") from exc
    try:
        model = onnx.load(path, load_external_data=False)
        onnx.checker.check_model(model)
    except Exception as exc:
        raise ValueError(f"无法解析或校验 ONNX 文件: {path}") from exc
    values = list(model.graph.input)
    if len(values) != 1:
        raise ValueError(f"PicoDet 必须只有一个输入，实际为 {len(values)}")
    value = values[0]
    tensor = value.type.tensor_type
    shape = [dim.dim_value for dim in tensor.shape.dim]
    dtype = _dtype_name(onnx, tensor.elem_type)
    if {"name": value.name, "shape": shape, "dtype": dtype} != EXPECTED_INPUT:
        raise ValueError(f"输入契约不匹配: name={value.name}, shape={shape}, dtype={dtype}")
    opsets = [item.version for item in model.opset_import if item.domain in ("", "ai.onnx")]
    if opsets != [EXPECTED_OPSET]:
        raise ValueError(f"ONNX opset 必须为 11，实际为 {opsets}")
    outputs = []
    for output in model.graph.output:
        out_tensor = output.type.tensor_type
        outputs.append({
            "name": output.name,
            "dtype": _dtype_name(onnx, out_tensor.elem_type),
            "shape": [
                -1 if dimension.dim_param else dimension.dim_value
                for dimension in out_tensor.shape.dim
            ],
        })
    if not outputs:
        raise ValueError("PicoDet ONNX 必须至少有一个检测输出")
    validate_detection_outputs(outputs)
    parameter_count = 0
    for initializer in model.graph.initializer:
        count = 1
        for dim in initializer.dims:
            count *= dim
        parameter_count += count
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "input": {"name": value.name, "shape": shape, "dtype": dtype}, "outputs": outputs, "opset": EXPECTED_OPSET, "parameterCount": parameter_count}

def main() -> None:
    parser = argparse.ArgumentParser(description="检查 PicoDet ONNX 图契约")
    parser.add_argument("--model", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    model_path = args.model
    if model_path is None and args.manifest is not None:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        variants = manifest.get("variants", [])
        if not variants:
            print("manifest 当前为 labs/blocked，暂无可检查的 ONNX 产物")
            return
        model_path = args.manifest.parent / variants[0]["filename"]
    if model_path is None:
        parser.error("需要 --model 或 --manifest")
    result = inspect_onnx(model_path.resolve())
    payload = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")

if __name__ == "__main__":
    main()
