from __future__ import annotations

import copy
import io
import math
from contextlib import redirect_stdout
from numbers import Integral, Real
from typing import Any

from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval


_METRIC_INDICES = {
    "AP": 0,
    "AP50": 1,
    "AP75": 2,
    "APSmall": 3,
    "APMedium": 4,
    "APLarge": 5,
    "AR1": 6,
    "AR10": 7,
    "AR100": 8,
}


def _require_list(value: object, name: str) -> list:
    if not isinstance(value, list):
        raise ValueError(f"{name} 必须是 JSON 数组")
    return value


def _require_id(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise ValueError(f"{name} 必须是整数")
    return int(value)


def _validate_bbox(value: object, name: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{name} 必须是四项数组 [x, y, w, h]")
    if any(isinstance(item, bool) or not isinstance(item, Real) for item in value):
        raise ValueError(f"{name} 必须只包含数值")
    bbox = [float(item) for item in value]
    if not all(math.isfinite(item) for item in bbox):
        raise ValueError(f"{name} 包含非有限坐标")
    if bbox[2] <= 0 or bbox[3] <= 0:
        raise ValueError(f"{name} 的宽和高必须大于零")
    return bbox


def _validate_inputs(
    annotations: dict, predictions: list[dict], image_ids: list[int]
) -> tuple[dict, list[dict], list[int]]:
    if not isinstance(annotations, dict):
        raise ValueError("annotations 必须是 JSON 对象")
    if not isinstance(predictions, list):
        raise ValueError("predictions 必须是 JSON 数组")
    image_ids = _require_list(image_ids, "image-ids")
    selected_ids = [_require_id(value, "image-ids 项") for value in image_ids]
    if not selected_ids:
        raise ValueError("image-ids 至少要包含一个图片 ID")
    if len(selected_ids) != len(set(selected_ids)):
        raise ValueError("image-ids 包含重复图片 ID")

    images = _require_list(annotations.get("images"), "annotations.images")
    categories = _require_list(annotations.get("categories"), "annotations.categories")
    ground_truth = _require_list(
        annotations.get("annotations"), "annotations.annotations"
    )

    declared_image_ids = [
        _require_id(item.get("id"), "图片 id")
        for item in images
        if isinstance(item, dict)
    ]
    if len(declared_image_ids) != len(images):
        raise ValueError("annotations.images 的每一项都必须是对象")
    if len(declared_image_ids) != len(set(declared_image_ids)):
        raise ValueError("annotations.images 包含重复图片 ID")
    missing_ids = sorted(set(selected_ids) - set(declared_image_ids))
    if missing_ids:
        raise ValueError(f"image-ids 包含未知图片：{missing_ids}")

    category_ids = [
        _require_id(item.get("id"), "类别 id")
        for item in categories
        if isinstance(item, dict)
    ]
    if len(category_ids) != len(categories):
        raise ValueError("annotations.categories 的每一项都必须是对象")
    if len(category_ids) != len(set(category_ids)):
        raise ValueError("annotations.categories 包含重复类别 ID")
    category_id_set = set(category_ids)
    declared_image_id_set = set(declared_image_ids)

    annotation_ids: list[int] = []
    for index, annotation in enumerate(ground_truth):
        if not isinstance(annotation, dict):
            raise ValueError(f"annotations.annotations[{index}] 必须是对象")
        annotation_ids.append(_require_id(annotation.get("id"), f"标注 {index} 的 id"))
        image_id = _require_id(
            annotation.get("image_id"), f"标注 {index} 的 image_id"
        )
        category_id = _require_id(
            annotation.get("category_id"), f"标注 {index} 的 category_id"
        )
        if image_id not in declared_image_id_set:
            raise ValueError(f"标注 {index} 引用了未知图片 {image_id}")
        if category_id not in category_id_set:
            raise ValueError(f"标注 {index} 引用了未知类别 {category_id}")
        _validate_bbox(annotation.get("bbox"), f"标注 {index} 的 bbox")
    if len(annotation_ids) != len(set(annotation_ids)):
        raise ValueError("annotations.annotations 包含重复标注 ID")

    selected_id_set = set(selected_ids)
    normalized_predictions: list[dict] = []
    for index, prediction in enumerate(predictions):
        if not isinstance(prediction, dict):
            raise ValueError(f"预测 {index} 必须是对象")
        image_id = _require_id(
            prediction.get("image_id"), f"预测 {index} 的 image_id"
        )
        category_id = _require_id(
            prediction.get("category_id"), f"预测 {index} 的 category_id"
        )
        if image_id not in declared_image_id_set:
            raise ValueError(f"预测 {index} 引用了未知图片 {image_id}")
        if image_id not in selected_id_set:
            raise ValueError(f"预测 {index} 引用了未选图片 {image_id}")
        if category_id not in category_id_set:
            raise ValueError(f"预测 {index} 引用了未知类别 {category_id}")
        bbox = _validate_bbox(prediction.get("bbox"), f"预测 {index} 的 bbox")
        score = prediction.get("score")
        if (
            isinstance(score, bool)
            or not isinstance(score, Real)
            or not math.isfinite(float(score))
        ):
            raise ValueError(f"预测 {index} 的 score 必须是有限数值")
        normalized_predictions.append(
            {
                "image_id": image_id,
                "category_id": category_id,
                "bbox": bbox,
                "score": float(score),
            }
        )

    dataset = copy.deepcopy(annotations)
    dataset.setdefault("info", {})
    dataset.setdefault("licenses", [])
    return dataset, normalized_predictions, selected_ids


def _empty_results(dataset: dict) -> COCO:
    results = COCO()
    results.dataset = {
        "info": copy.deepcopy(dataset["info"]),
        "images": copy.deepcopy(dataset["images"]),
        "categories": copy.deepcopy(dataset["categories"]),
        "annotations": [],
    }
    results.createIndex()
    return results


def evaluate_coco(
    annotations: dict, predictions: list[dict], image_ids: list[int]
) -> dict[str, Any]:
    """使用官方 pycocotools COCOeval 计算指定图片的 bbox 指标。"""
    dataset, normalized_predictions, selected_ids = _validate_inputs(
        annotations, predictions, image_ids
    )

    # pycocotools 会打印进度；库接口保持安静，由调用方决定如何展示报告。
    with redirect_stdout(io.StringIO()):
        ground_truth = COCO()
        ground_truth.dataset = dataset
        ground_truth.createIndex()
        detections = (
            ground_truth.loadRes(normalized_predictions)
            if normalized_predictions
            else _empty_results(dataset)
        )
        evaluator = COCOeval(ground_truth, detections, "bbox")
        evaluator.params.imgIds = selected_ids
        evaluator.evaluate()
        evaluator.accumulate()
        evaluator.summarize()

    metrics = {
        name: (
            None
            if float(evaluator.stats[index]) < 0
            else float(evaluator.stats[index])
        )
        for name, index in _METRIC_INDICES.items()
    }
    selected_id_set = set(selected_ids)
    return {
        "metrics": metrics,
        "imageIds": selected_ids,
        "imageCount": len(selected_ids),
        "groundTruthCount": sum(
            1 for item in dataset["annotations"] if item["image_id"] in selected_id_set
        ),
        "predictionCount": len(normalized_predictions),
        "evaluator": "pycocotools.COCOeval",
    }
