from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np

try:
    from evaluation import evaluate_coco
except ModuleNotFoundError:  # 允许按脚本路径直接执行
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from evaluation import evaluate_coco


def preprocess_image(rgb: np.ndarray, *, model: str, size: int) -> np.ndarray:
    if model not in {"picodet", "ppyoloe", "ppyoloe-pillow"}:
        raise ValueError(f"未知模型类型：{model}")
    if model == "ppyoloe":
        import cv2

        resized = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    else:
        from PIL import Image

        resized = np.asarray(Image.fromarray(rgb).resize((size, size), Image.Resampling.BICUBIC), dtype=np.float32)
    resized /= np.float32(255)
    if model == "picodet":
        resized = (resized - np.asarray([0.485, 0.456, 0.406], dtype=np.float32)) / np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
    return resized.transpose(2, 0, 1)[None].copy()


def detections_to_coco(rows: np.ndarray, *, image: dict, category_ids: list[int], input_size: int, score_threshold: float = 0.001) -> list[dict[str, object]]:
    result = []
    for row in rows:
        if row.shape != (6,) or not np.isfinite(row).all():
            raise ValueError("检测输出必须是有限数值 [class,score,x1,y1,x2,y2]")
        label, score = int(row[0]), float(row[1])
        if not 0 <= label < len(category_ids):
            raise ValueError(f"模型输出未知类别索引 {label}")
        if score < score_threshold:
            continue
        x1, y1, x2, y2 = map(float, row[2:])
        x1, x2 = [min(image["width"], max(0.0, value * image["width"] / input_size)) for value in (x1, x2)]
        y1, y2 = [min(image["height"], max(0.0, value * image["height"] / input_size)) for value in (y1, y2)]
        if x2 <= x1 or y2 <= y1:
            continue
        result.append({"image_id": int(image["id"]), "category_id": category_ids[label], "bbox": [x1, y1, x2 - x1, y2 - y1], "score": score})
    return result


def run(args: argparse.Namespace) -> dict[str, object]:
    import cv2
    import onnxruntime as ort

    dataset = json.loads(args.annotations.read_text(encoding="utf-8"))
    category_ids = [int(item["id"]) for item in sorted(dataset["categories"], key=lambda item: int(item["id"]))]
    size = 320 if args.model_kind == "picodet" else 640
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    started = time.perf_counter()
    session = ort.InferenceSession(str(args.model), sess_options=options, providers=["CPUExecutionProvider"])
    session_ms = (time.perf_counter() - started) * 1000
    predictions: list[dict[str, object]] = []
    timings = []
    for image in dataset["images"]:
        path = args.images_dir / image["file_name"]
        bgr = cv2.imread(str(path))
        if bgr is None:
            raise ValueError(f"无法读取图片：{path}")
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        started = time.perf_counter()
        tensor = preprocess_image(rgb, model=args.model_kind, size=size)
        preprocess_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        values = session.run(None, {"image": tensor})
        inference_ms = (time.perf_counter() - started) * 1000
        rows = next((value for value in values if value.ndim == 2 and value.shape[-1] == 6), None)
        if rows is None:
            raise ValueError("模型没有 [N,6] 检测输出")
        current = detections_to_coco(rows, image=image, category_ids=category_ids, input_size=size)
        predictions.extend(current)
        timings.append({"imageId": image["id"], "preprocessMs": preprocess_ms, "inferenceMs": inference_ms, "detections": len(current)})
    image_ids = [int(item["id"]) for item in dataset["images"]]
    args.predictions.parent.mkdir(parents=True, exist_ok=True)
    args.predictions.write_text(json.dumps(predictions, ensure_ascii=False) + "\n", encoding="utf-8")
    report = {
        "model": args.model_kind,
        "modelPath": str(args.model),
        "modelSha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
        "modelBytes": args.model.stat().st_size,
        "sessionMs": session_ms,
        "medianPreprocessMs": statistics.median(item["preprocessMs"] for item in timings),
        "medianInferenceMs": statistics.median(item["inferenceMs"] for item in timings),
        "images": timings,
        "evaluation": evaluate_coco(dataset, predictions, image_ids),
        "environment": {"python": platform.python_version(), "platform": platform.platform(), "onnxruntime": ort.__version__, "backend": "CPUExecutionProvider", "intraOpThreads": args.threads},
        "preprocessing": "OpenCV INTER_CUBIC RGB /255" if args.model_kind == "ppyoloe" else ("Pillow BICUBIC RGB /255" if args.model_kind == "ppyoloe-pillow" else "Pillow BICUBIC RGB /255 + ImageNet normalize"),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="运行 PicoDet 或 PP-YOLOE 的正式 CPU 子集评测")
    parser.add_argument("--model-kind", choices=["picodet", "ppyoloe", "ppyoloe-pillow"], required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    try:
        run(args)
    except Exception as exc:
        print(f"CPU 推理失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
