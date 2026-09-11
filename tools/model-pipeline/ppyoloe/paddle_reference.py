"""运行官方 Paddle 静态模型，供转换结果的一对一核验使用。"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evaluation import compare_detections, evaluate_coco
from ppyoloe.inference import detections_to_coco, preprocess_image


def run(args: argparse.Namespace) -> None:
    import paddle
    import paddle.inference as pdi

    dataset = json.loads(args.annotations.read_text(encoding="utf-8"))
    image_ids = [image["id"] for image in dataset["images"]]
    category_ids = sorted(category["id"] for category in dataset["categories"])
    model_path = args.exported_dir / "model.pdmodel"
    parameters_path = args.exported_dir / "model.pdiparams"
    config = pdi.Config(str(model_path), str(parameters_path))
    config.disable_gpu()
    config.set_cpu_math_library_num_threads(4)
    config.disable_glog_info()
    predictor = pdi.create_predictor(config)
    if set(predictor.get_input_names()) != {"image", "scale_factor"}:
        raise ValueError("官方模型输入必须是 image 和 scale_factor")
    predictions, timings = [], []
    for image in dataset["images"]:
        source = cv2.imread(str(args.images_dir / image["file_name"]))
        if source is None:
            raise ValueError(f"无法读取图片：{image['file_name']}")
        rgb = cv2.cvtColor(source, cv2.COLOR_BGR2RGB)
        tensor = preprocess_image(rgb, model="ppyoloe", size=640)
        predictor.get_input_handle("image").copy_from_cpu(tensor)
        predictor.get_input_handle("scale_factor").copy_from_cpu(np.ones((1, 2), dtype=np.float32))
        started = time.perf_counter()
        predictor.run()
        elapsed = (time.perf_counter() - started) * 1000
        outputs = [predictor.get_output_handle(name).copy_to_cpu() for name in predictor.get_output_names()]
        rows = next(value for value in outputs if value.ndim == 2 and value.shape[-1] == 6)
        predictions.extend(detections_to_coco(rows, image=image, category_ids=category_ids, input_size=640))
        timings.append({"imageId": image["id"], "inferenceMs": elapsed})
    report = {
        "paddleVersion": paddle.__version__,
        "backend": "CPU",
        "threads": 4,
        "modelSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        "parametersSha256": hashlib.sha256(parameters_path.read_bytes()).hexdigest(),
        "annotationsSha256": hashlib.sha256(args.annotations.read_bytes()).hexdigest(),
        "preprocessing": "OpenCV INTER_CUBIC RGB /255，scale_factor=[[1,1]]",
        "evaluation": evaluate_coco(dataset, predictions, image_ids),
        "images": timings,
    }
    if args.onnx_predictions:
        candidate = json.loads(args.onnx_predictions.read_text(encoding="utf-8"))
        report["comparison"] = {
            "iouThreshold": 0.99,
            "scoreThreshold": 0.5,
            "images": [
                {"imageId": image_id, **compare_detections(
                    [item for item in predictions if item["image_id"] == image_id],
                    [item for item in candidate if item["image_id"] == image_id],
                    iou_threshold=0.99, score_threshold=0.5,
                )}
                for image_id in image_ids
            ],
        }
    for path, data in [(args.predictions, predictions), (args.report, report)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("exported-dir", "annotations", "images-dir", "predictions", "report"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--onnx-predictions", type=Path)
    try:
        run(parser.parse_args())
    except Exception as error:
        print(f"Paddle 参考核验失败：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
