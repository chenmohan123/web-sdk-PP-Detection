from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse


def _dtype_name(onnx, dtype: int) -> str:
    return {onnx.TensorProto.FLOAT: "float32", onnx.TensorProto.INT32: "int32", onnx.TensorProto.INT64: "int64"}.get(dtype, f"onnx:{dtype}")


def _tensor(onnx, value) -> dict[str, object]:
    return {
        "name": value.name,
        "shape": [-1 if item.dim_param else item.dim_value for item in value.type.tensor_type.shape.dim],
        "dtype": _dtype_name(onnx, value.type.tensor_type.elem_type),
    }


def _runtime_tensor(value) -> dict[str, object]:
    dtype = {"tensor(float)": "float32", "tensor(int32)": "int32", "tensor(int64)": "int64"}.get(value.type, value.type)
    return {
        "name": value.name,
        "shape": [dimension if isinstance(dimension, int) else -1 for dimension in value.shape],
        "dtype": dtype,
    }


def build_runtime_manifest(model_path: Path, annotations: dict, *, download_url: str) -> dict[str, object]:
    import onnx
    import onnxruntime as ort

    parsed = urlparse(download_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("downloadUrl 必须是含主机的 HTTP(S) URL")
    model = onnx.load(model_path, load_external_data=False)
    onnx.checker.check_model(model)
    if len(model.graph.input) != 1:
        raise ValueError("候选模型必须只有 image 输入")
    input_contract = _tensor(onnx, model.graph.input[0])
    if input_contract != {"name": "image", "shape": [1, 3, 640, 640], "dtype": "float32"}:
        raise ValueError(f"候选模型输入契约不匹配：{input_contract}")
    opsets = [item.version for item in model.opset_import if item.domain in {"", "ai.onnx"}]
    if opsets != [11]:
        raise ValueError(f"候选模型 opset 必须为 11，实际为 {opsets}")
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    outputs = [_runtime_tensor(output) for output in session.get_outputs()]
    first_shape = outputs[0]["shape"] if len(outputs) == 2 else []
    valid_first_shape = (
        isinstance(first_shape, list)
        and len(first_shape) == 2
        and first_shape[1] == 6
        and isinstance(first_shape[0], int)
        and (first_shape[0] == -1 or first_shape[0] > 0)
    )
    if not valid_first_shape or outputs[0]["dtype"] != "float32" or outputs[1]["shape"] != [1] or outputs[1]["dtype"] != "int32":
        raise ValueError(f"候选模型输出必须为 [N,6] float32 和 [1] int32，实际为 {outputs}")
    outputs[0]["shape"] = [-1, 6]
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    categories = sorted(annotations["categories"], key=lambda item: int(item["id"]))
    variant = {
        "id": "ppyoloe-plus-s-640-fp32",
        "precision": "fp32",
        "quantization": None,
        "opset": 11,
        "bytes": model_path.stat().st_size,
        "parameterCount": None,
        "backends": ["wasm", "webgpu"],
        "status": "labs",
        "sources": [{
            "kind": "custom",
            "repository": "PaddlePaddle/PaddleDetection",
            "revision": digest,
            "path": model_path.name,
            "downloadUrl": download_url,
            "bytes": model_path.stat().st_size,
            "sha256": digest,
        }],
    }
    return {
        "schemaVersion": 1,
        "model": {"id": "ppyoloe-plus-s-640", "version": "b25522a0"},
        "input": input_contract,
        "outputs": outputs,
        "preprocessing": {"size": {"width": 640, "height": 640}, "rescaleFactor": 1 / 255, "resizeMode": "stretch", "interpolation": "bicubic", "mean": [0, 0, 0], "std": [1, 1, 1], "doResize": True, "doRescale": True, "doNormalize": True},
        "postprocessing": {"type": "nms", "scoreThreshold": 0.001, "iouThreshold": 1.0, "matrixCoordinates": "pixels", "queryCoordinates": "pixels", "queryBoxFormat": "xyxy"},
        "labels": [item["name"] for item in categories],
        "variants": [variant],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="从实际 PP-YOLOE ONNX 生成本地 labs runtime manifest")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--download-url", default="http://localhost:4173/ppyoloe-plus-s-candidate.onnx")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = build_runtime_manifest(args.model, json.loads(args.annotations.read_text(encoding="utf-8")), download_url=args.download_url)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        print(f"manifest 生成失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
