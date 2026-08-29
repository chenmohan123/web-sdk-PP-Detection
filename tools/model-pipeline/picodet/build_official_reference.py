"""生成 PicoDet 官方 ONNX 的离线检测输出参考。

该文件只生成浏览器 benchmark 的比较基线，不会生成 SDK 可加载的模型清单。
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


ROOT = Path(__file__).parents[3]
FIXTURE_ROOT = ROOT / "tools" / "model-pipeline" / "fixtures" / "images"
DEFAULT_MODEL = ROOT / "work" / "picodet-l-320-postprocessed.onnx"
DEFAULT_OUTPUT = ROOT / "tools" / "model-pipeline" / "references" / "picodet-l-320-official-output.json"
FIXTURE_LOCK = ROOT / "tools" / "model-pipeline" / "fixtures" / "fixtures.lock.json"
INPUT_SIZE = (320, 320)
MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
SCORE_THRESHOLD = 0.5
OFFICIAL_SHA256 = "f602c83aeea1ef65d226cdd272a6b2e603a67dfd97c8ace6acc906c73bff5d89"
OFFICIAL_BYTES = 23226341
OFFICIAL_REVISION = "206730a8453b23db94898500f47f8ea14426b23d"
FIXTURE_NAMES = (
    "curved-document.jpg",
    "doc-formula.png",
    "image-layout.jpg",
    "layout-demo.jpg",
    "screen-photo.jpg",
    "skew-document.jpg",
    "table.png",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_input(path: Path) -> tuple[np.ndarray, tuple[int, int]]:
    with Image.open(path) as opened:
        image = opened.convert("RGB")
        width, height = image.size
        resized = image.resize(INPUT_SIZE, Image.Resampling.BICUBIC)
        pixels = np.asarray(resized, dtype=np.float32) / 255.0
    chw = np.transpose((pixels - MEAN) / STD, (2, 0, 1))[None, ...]
    return chw.astype(np.float32, copy=False), (width, height)


def verify_fixture_lock(fixture_root: Path) -> list[dict[str, Any]]:
    lock = json.loads(FIXTURE_LOCK.read_text(encoding="utf-8"))
    entries = lock.get("fixtures")
    if not isinstance(entries, list) or [entry.get("filename") for entry in entries] != list(FIXTURE_NAMES):
        raise ValueError("fixtures.lock.json 未覆盖固定的七张 fixture 或顺序不一致")
    verified: list[dict[str, Any]] = []
    for entry in entries:
        filename = entry.get("filename")
        path = fixture_root / filename
        if not path.is_file():
            raise ValueError(f"fixture 文件不存在: {filename}")
        with Image.open(path) as opened:
            width, height = opened.size
        actual_sha256 = sha256_file(path)
        if (width, height) != (entry.get("width"), entry.get("height")):
            raise ValueError(f"fixture 尺寸与 lock 不一致: {filename}")
        if actual_sha256 != entry.get("sha256"):
            raise ValueError(f"fixture SHA-256 与 lock 不一致: {filename}")
        verified.append({"filename": filename, "width": width, "height": height, "sha256": actual_sha256})
    return verified


def box_iou(left: list[float], right: list[float]) -> float:
    x_min = max(left[0], right[0])
    y_min = max(left[1], right[1])
    x_max = min(left[2], right[2])
    y_max = min(left[3], right[3])
    intersection = max(0.0, x_max - x_min) * max(0.0, y_max - y_min)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return 0.0 if union <= 0 else intersection / union


def detections_for_output(matrix: np.ndarray, original_size: tuple[int, int], labels: list[str]) -> list[dict[str, Any]]:
    original_width, original_height = original_size
    scale_x = original_width / INPUT_SIZE[0]
    scale_y = original_height / INPUT_SIZE[1]
    candidates: list[dict[str, Any]] = []
    for row_index, row in enumerate(np.asarray(matrix, dtype=np.float64)):
        class_id = int(np.trunc(row[0]))
        score = float(row[1])
        if not np.isfinite(row).all() or score < SCORE_THRESHOLD:
            continue
        box = [
            min(max(float(row[2]) * scale_x, 0.0), float(original_width)),
            min(max(float(row[3]) * scale_y, 0.0), float(original_height)),
            min(max(float(row[4]) * scale_x, 0.0), float(original_width)),
            min(max(float(row[5]) * scale_y, 0.0), float(original_height)),
        ]
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        candidates.append({"index": row_index, "classId": class_id, "score": score, "box": box})

    selected: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: (-item["score"], item["index"])):
        if any(
            kept["classId"] == candidate["classId"] and box_iou(kept["box"], candidate["box"]) > 0.5
            for kept in selected
        ):
            continue
        selected.append(candidate)

    result: list[dict[str, Any]] = []
    for reading_order, candidate in enumerate(selected):
        class_id = candidate["classId"]
        x_min, y_min, x_max, y_max = candidate["box"]
        result.append(
            {
                "index": candidate["index"],
                "classId": class_id,
                "labelId": class_id,
                "label": labels[class_id] if 0 <= class_id < len(labels) else str(class_id),
                "score": candidate["score"],
                "readingOrder": reading_order,
                "box": {
                    "x": x_min,
                    "y": y_min,
                    "width": x_max - x_min,
                    "height": y_max - y_min,
                    "xMin": x_min,
                    "yMin": y_min,
                    "xMax": x_max,
                    "yMax": y_max,
                },
                "polygon": [
                    {"x": x_min, "y": y_min},
                    {"x": x_max, "y": y_min},
                    {"x": x_max, "y": y_max},
                    {"x": x_min, "y": y_max},
                ],
            }
        )
    return result


def build_reference(model_path: Path, fixture_root: Path) -> dict[str, Any]:
    import onnxruntime as ort

    if model_path.stat().st_size != OFFICIAL_BYTES or sha256_file(model_path) != OFFICIAL_SHA256:
        raise ValueError("官方 ONNX 文件大小或 SHA-256 与固定摘要不一致")
    labels = (ROOT / "models" / "pp-detection" / "1.0.0" / "labels" / "coco.txt").read_text(encoding="utf-8").splitlines()
    session_options = ort.SessionOptions()
    session_options.log_severity_level = 4
    session = ort.InferenceSession(str(model_path), session_options, providers=["CPUExecutionProvider"])
    input_names = [item.name for item in session.get_inputs()]
    if input_names != ["image", "scale_factor"]:
        raise ValueError(f"官方 ONNX 输入契约不匹配: {input_names}")
    fixtures: list[dict[str, Any]] = []
    for locked in verify_fixture_lock(fixture_root):
        filename = locked["filename"]
        fixture_path = fixture_root / filename
        image, original_size = prepare_input(fixture_path)
        outputs = session.run(None, {"image": image, "scale_factor": np.asarray([[1.0, 1.0]], dtype=np.float32)})
        matrices = [value for value in outputs if value.ndim == 2 and value.shape[-1] == 6]
        if len(matrices) != 1:
            raise ValueError(f"官方 ONNX 未返回唯一检测矩阵: {filename}")
        fixtures.append(
            {
                "filename": filename,
                "width": original_size[0],
                "height": original_size[1],
                "sha256": locked["sha256"],
                "detections": detections_for_output(matrices[0], original_size, labels),
            }
        )

    return {
        "schemaVersion": 1,
        "type": "offline-official-output",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "generator": {
            "script": "tools/model-pipeline/picodet/build_official_reference.py",
            "runtime": f"onnxruntime {ort.__version__}",
        },
        "model": {
            "id": "pp-picodet-l-320",
            "version": "1.0.0",
            "repository": "PaddlePaddle/PaddleDetection",
            "revision": OFFICIAL_REVISION,
            "path": "work/picodet-l-320-postprocessed.onnx",
            "bytes": OFFICIAL_BYTES,
            "sha256": OFFICIAL_SHA256,
            "downloadUrl": "https://paddledet.bj.bcebos.com/deploy/third_engine/picodet_l_320_lcnet_postprocessed.onnx",
            "documentationPath": "configs/picodet/README.md",
        },
        "preprocessing": {
            "inputSize": {"width": INPUT_SIZE[0], "height": INPUT_SIZE[1]},
            "resizeMode": "stretch",
            "interpolation": "bicubic",
            "rescaleFactor": 1 / 255,
            "mean": MEAN.tolist(),
            "std": STD.tolist(),
            "coordinateSpace": "original-pixels",
            "scoreThreshold": SCORE_THRESHOLD,
        },
        "fixtures": fixtures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 PicoDet 官方 ONNX 离线输出 reference")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--fixture-root", type=Path, default=FIXTURE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    reference = build_reference(args.model.resolve(), args.fixture_root.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(reference, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
