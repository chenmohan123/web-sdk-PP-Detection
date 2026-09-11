from __future__ import annotations

import math
from numbers import Integral, Real
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment


def _validate_threshold(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{name} 必须是数值")
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} 必须是 0 到 1 之间的有限数值")
    return value


def _validate_detection(item: object, side: str, index: int) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError(f"{side}[{index}] 必须是对象")
    category_id = item.get("category_id")
    if isinstance(category_id, bool) or not isinstance(category_id, Integral):
        raise ValueError(f"{side}[{index}].category_id 必须是整数")
    bbox = item.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError(f"{side}[{index}].bbox 必须是四项数组 [x, y, w, h]")
    if any(isinstance(value, bool) or not isinstance(value, Real) for value in bbox):
        raise ValueError(f"{side}[{index}].bbox 必须只包含数值")
    normalized_bbox = [float(value) for value in bbox]
    if not all(math.isfinite(value) for value in normalized_bbox):
        raise ValueError(f"{side}[{index}].bbox 包含非有限坐标")
    if normalized_bbox[2] <= 0 or normalized_bbox[3] <= 0:
        raise ValueError(f"{side}[{index}].bbox 的宽和高必须大于零")
    score = item.get("score")
    if (
        isinstance(score, bool)
        or not isinstance(score, Real)
        or not math.isfinite(float(score))
    ):
        raise ValueError(f"{side}[{index}].score 必须是有限数值")
    return {
        "index": index,
        "category_id": int(category_id),
        "bbox": normalized_bbox,
        "score": float(score),
        "source": item,
    }


def _iou(left: list[float], right: list[float]) -> float:
    left_x2, left_y2 = left[0] + left[2], left[1] + left[3]
    right_x2, right_y2 = right[0] + right[2], right[1] + right[3]
    intersection_width = max(0.0, min(left_x2, right_x2) - max(left[0], right[0]))
    intersection_height = max(0.0, min(left_y2, right_y2) - max(left[1], right[1]))
    intersection = intersection_width * intersection_height
    return intersection / (left[2] * left[3] + right[2] * right[3] - intersection)


def _content_key(item: dict[str, Any]) -> tuple[int, float, float, float, float, float]:
    return (
        item["category_id"],
        *item["bbox"],
        item["score"],
    )


def compare_detections(
    reference: list[dict],
    candidate: list[dict],
    *,
    iou_threshold: float = 0.5,
    score_threshold: float = 0.5,
) -> dict[str, Any]:
    """按类别执行一对一匹配，并报告阈值以上检测的一致性差异。"""
    if not isinstance(reference, list) or not isinstance(candidate, list):
        raise ValueError("reference 和 candidate 必须是数组")
    iou_threshold = _validate_threshold(iou_threshold, "iou_threshold")
    score_threshold = _validate_threshold(score_threshold, "score_threshold")
    validated_reference = [
        _validate_detection(item, "reference", index)
        for index, item in enumerate(reference)
    ]
    validated_candidate = [
        _validate_detection(item, "candidate", index)
        for index, item in enumerate(candidate)
    ]
    active_reference = sorted(
        (item for item in validated_reference if item["score"] >= score_threshold),
        key=_content_key,
    )
    active_candidate = sorted(
        (item for item in validated_candidate if item["score"] >= score_threshold),
        key=_content_key,
    )

    matches: list[dict[str, Any]] = []
    matched_reference_indices: set[int] = set()
    matched_candidate_indices: set[int] = set()
    categories = sorted(
        {item["category_id"] for item in active_reference}
        | {item["category_id"] for item in active_candidate}
    )
    for category_id in categories:
        reference_rows = [
            item for item in active_reference if item["category_id"] == category_id
        ]
        candidate_rows = [
            item for item in active_candidate if item["category_id"] == category_id
        ]
        if not reference_rows or not candidate_rows:
            continue
        ious = np.asarray(
            [
                [
                    _iou(reference_item["bbox"], candidate_item["bbox"])
                    for candidate_item in candidate_rows
                ]
                for reference_item in reference_rows
            ],
            dtype=np.float64,
        )
        # 有效边奖励大于全部 IoU 差之和，确保先最大化匹配数，再最大化总 IoU。
        valid_bonus = min(len(reference_rows), len(candidate_rows)) + 1.0
        weights = np.where(ious >= iou_threshold, valid_bonus + ious, 0.0)
        reference_assignment, candidate_assignment = linear_sum_assignment(
            weights, maximize=True
        )
        for reference_position, candidate_position in zip(
            reference_assignment, candidate_assignment, strict=True
        ):
            iou = float(ious[reference_position, candidate_position])
            if iou < iou_threshold:
                continue
            reference_item = reference_rows[int(reference_position)]
            candidate_item = candidate_rows[int(candidate_position)]
            bbox_deltas = [
                abs(left - right)
                for left, right in zip(
                    reference_item["bbox"], candidate_item["bbox"], strict=True
                )
            ]
            matched_reference_indices.add(reference_item["index"])
            matched_candidate_indices.add(candidate_item["index"])
            matches.append(
                {
                    "referenceIndex": reference_item["index"],
                    "candidateIndex": candidate_item["index"],
                    "categoryId": category_id,
                    "iou": iou,
                    "scoreDelta": abs(
                        reference_item["score"] - candidate_item["score"]
                    ),
                    "maxBboxDeltaPixels": max(bbox_deltas),
                }
            )

    unmatched_reference = [
        item["source"]
        for item in active_reference
        if item["index"] not in matched_reference_indices
    ]
    unmatched_candidate = [
        item["source"]
        for item in active_candidate
        if item["index"] not in matched_candidate_indices
    ]
    return {
        "referenceCount": len(active_reference),
        "candidateCount": len(active_candidate),
        "matchedCount": len(matches),
        "unmatchedReferenceCount": len(unmatched_reference),
        "unmatchedCandidateCount": len(unmatched_candidate),
        "unmatchedReference": unmatched_reference,
        "unmatchedCandidate": unmatched_candidate,
        "matches": matches,
        "maxScoreDelta": max((item["scoreDelta"] for item in matches), default=None),
        "maxBboxDeltaPixels": max(
            (item["maxBboxDeltaPixels"] for item in matches), default=None
        ),
    }
