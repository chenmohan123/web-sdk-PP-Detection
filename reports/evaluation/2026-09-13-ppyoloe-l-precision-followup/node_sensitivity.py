"""在固定图片集上统计 PP-YOLOE+ L 各卷积节点的精度敏感度。"""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import cv2
import numpy as np
import onnx
import onnxruntime as ort


def prepare(path: Path, output: Path) -> list[str]:
    model = onnx.shape_inference.infer_shapes(onnx.load(str(path), load_external_data=False))
    existing = {item.name for item in model.graph.output}
    infos = {item.name: item for item in [*model.graph.value_info, *model.graph.input, *model.graph.output]}
    names: list[str] = []
    for node in model.graph.node:
        if node.op_type != "Conv" or not node.output or node.output[0] in existing:
            continue
        info = infos.get(node.output[0])
        if info is None:
            continue
        model.graph.output.append(info)
        names.append(node.output[0])
    onnx.save(model, str(output))
    return names


def tensor(image: Path) -> np.ndarray:
    bgr = cv2.imread(str(image))
    if bgr is None:
        raise ValueError(f"无法读取图片：{image}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (640, 640), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    return (resized / np.float32(255)).transpose(2, 0, 1)[None].copy()


def run(args: argparse.Namespace) -> dict[str, object]:
    models = {"fp32": args.fp32, "fp16": args.fp16, "w8a32": args.w8a32}
    images = sorted(args.images.glob("*.jpg"))[: args.limit]
    if not images:
        raise ValueError("没有找到 JPG 输入图片")
    with tempfile.TemporaryDirectory(prefix="ppyoloe-sensitivity-") as directory:
        prepared = {label: Path(directory) / f"{label}.onnx" for label in models}
        output_names = {label: prepare(path, prepared[label]) for label, path in models.items()}
        sessions = {label: ort.InferenceSession(str(prepared[label]), providers=["CPUExecutionProvider"]) for label in models}
        totals = {label: {} for label in ("fp16", "w8a32")}
        for image in images:
            values = {}
            input_tensor = tensor(image)
            for label, session in sessions.items():
                outputs = session.run(None, {"image": input_tensor})
                values[label] = dict(zip([item.name for item in session.get_outputs()], outputs))
            for label in ("fp16", "w8a32"):
                for name in output_names["fp32"]:
                    if name not in values[label]:
                        continue
                    reference = np.asarray(values["fp32"][name], dtype=np.float32)
                    candidate = np.asarray(values[label][name], dtype=np.float32)
                    if candidate.shape != reference.shape:
                        continue
                    delta = np.abs(reference - candidate)
                    item = totals[label].setdefault(name, {"sumAbs": 0.0, "count": 0, "maxAbs": 0.0})
                    item["sumAbs"] += float(delta.sum())
                    item["count"] += int(delta.size)
                    item["maxAbs"] = max(item["maxAbs"], float(delta.max()))
    summary = {}
    for label, items in totals.items():
        rows = [{"output": name, "meanAbs": data["sumAbs"] / data["count"], "maxAbs": data["maxAbs"]} for name, data in items.items() if data["count"]]
        summary[label] = sorted(rows, key=lambda row: row["meanAbs"], reverse=True)
    result = {"images": [item.name for item in images], "models": {label: str(path) for label, path in models.items()}, "nodes": summary}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fp32", type=Path, required=True)
    parser.add_argument("--fp16", type=Path, required=True)
    parser.add_argument("--w8a32", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = run(args)
    print(json.dumps({"images": len(result["images"]), "fp16Nodes": len(result["nodes"]["fp16"]), "w8a32Nodes": len(result["nodes"]["w8a32"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
