from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from evaluation import compare_detections, evaluate_coco


def _annotations() -> dict:
    return {
        "info": {"description": "评测测试数据"},
        "images": [
            {"id": 10, "width": 100, "height": 100, "file_name": "10.jpg"},
            {"id": 20, "width": 100, "height": 100, "file_name": "20.jpg"},
        ],
        "categories": [
            {"id": 1, "name": "类别一"},
            {"id": 3, "name": "类别三"},
        ],
        "annotations": [
            {
                "id": 1,
                "image_id": 10,
                "category_id": 1,
                "bbox": [10, 10, 20, 20],
                "area": 400,
                "iscrowd": 0,
            },
            {
                "id": 2,
                "image_id": 20,
                "category_id": 3,
                "bbox": [40, 30, 15, 10],
                "area": 150,
                "iscrowd": 0,
            },
        ],
    }


def _perfect_predictions() -> list[dict]:
    return [
        {"image_id": 10, "category_id": 1, "bbox": [10, 10, 20, 20], "score": 0.99},
        {"image_id": 20, "category_id": 3, "bbox": [40, 30, 15, 10], "score": 0.98},
    ]


def test_evaluate_coco_uses_official_metrics_and_original_category_ids() -> None:
    result = evaluate_coco(_annotations(), _perfect_predictions(), [10, 20])

    assert result["evaluator"] == "pycocotools.COCOeval"
    assert result["imageIds"] == [10, 20]
    assert result["imageCount"] == 2
    assert result["groundTruthCount"] == 2
    assert result["predictionCount"] == 2
    assert result["metrics"]["AP"] == pytest.approx(1.0)
    assert result["metrics"]["AP50"] == pytest.approx(1.0)
    assert result["metrics"]["AP75"] == pytest.approx(1.0)
    assert result["metrics"]["APSmall"] == pytest.approx(1.0)
    assert result["metrics"]["APMedium"] is None
    assert result["metrics"]["APLarge"] is None
    assert result["metrics"]["AR1"] == pytest.approx(1.0)
    assert result["metrics"]["AR10"] == pytest.approx(1.0)
    assert result["metrics"]["AR100"] == pytest.approx(1.0)


def test_evaluate_coco_empty_predictions_are_zero() -> None:
    result = evaluate_coco(_annotations(), [], [10, 20])

    assert result["predictionCount"] == 0
    assert result["metrics"]["AP"] == pytest.approx(0.0)
    assert result["metrics"]["AP50"] == pytest.approx(0.0)
    assert result["metrics"]["AR100"] == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("predictions", "image_ids", "message"),
    [
        (
            [{"image_id": 10, "category_id": 2, "bbox": [1, 1, 2, 2], "score": 0.9}],
            [10],
            "未知类别",
        ),
        (
            [{"image_id": 20, "category_id": 3, "bbox": [1, 1, 2, 2], "score": 0.9}],
            [10],
            "未选图片",
        ),
        (_perfect_predictions(), [10, 10], "重复"),
    ],
)
def test_evaluate_coco_rejects_invalid_mapping(
    predictions: list[dict], image_ids: list[int], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        evaluate_coco(_annotations(), predictions, image_ids)


@pytest.mark.parametrize(
    "prediction",
    [
        {"image_id": 10, "category_id": 1, "bbox": [1, 1, float("nan"), 2], "score": 0.9},
        {"image_id": 10, "category_id": 1, "bbox": [1, 1, 0, 2], "score": 0.9},
        {"image_id": 10, "category_id": 1, "bbox": [1, 1, 2, 2], "score": float("nan")},
    ],
)
def test_evaluate_coco_rejects_non_finite_or_invalid_predictions(prediction: dict) -> None:
    with pytest.raises(ValueError):
        evaluate_coco(_annotations(), [prediction], [10])


def test_compare_detections_matches_reversed_rows_by_category_and_geometry() -> None:
    reference = [
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.95},
        {"category_id": 3, "bbox": [50, 50, 20, 20], "score": 0.85},
    ]
    candidate = [
        {"category_id": 3, "bbox": [50, 50, 20, 20], "score": 0.80},
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.90},
    ]

    result = compare_detections(reference, candidate)

    assert result["matchedCount"] == 2
    assert result["unmatchedReference"] == []
    assert result["unmatchedCandidate"] == []
    assert result["maxScoreDelta"] == pytest.approx(0.05)
    assert result["maxBboxDeltaPixels"] == pytest.approx(0.0)


def test_compare_detections_maximizes_valid_one_to_one_matches() -> None:
    # 第一个候选可匹配两个参考框，第二个只能匹配第一个；按行贪心会漏配一个。
    reference = [
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.9},
        {"category_id": 1, "bbox": [4, 0, 10, 10], "score": 0.9},
    ]
    candidate = [
        {"category_id": 1, "bbox": [2, 0, 10, 10], "score": 0.9},
        {"category_id": 1, "bbox": [-2, 0, 10, 10], "score": 0.9},
    ]

    result = compare_detections(reference, candidate, iou_threshold=0.5)

    assert result["matchedCount"] == 2
    assert result["unmatchedReferenceCount"] == 0
    assert result["unmatchedCandidateCount"] == 0


def test_compare_detections_uses_content_to_break_equal_iou_ties() -> None:
    reference = [
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.9},
    ]
    left = {"category_id": 1, "bbox": [-2, 0, 10, 10], "score": 0.8}
    right = {"category_id": 1, "bbox": [2, 0, 10, 10], "score": 0.7}

    semantic_results = []
    for candidate in ([left, right], [right, left]):
        result = compare_detections(reference, candidate)
        semantic_results.append(
            {
                "matchedCandidate": candidate[
                    result["matches"][0]["candidateIndex"]
                ],
                "unmatchedCandidate": result["unmatchedCandidate"],
                "maxScoreDelta": result["maxScoreDelta"],
                "maxBboxDeltaPixels": result["maxBboxDeltaPixels"],
            }
        )

    assert semantic_results[0] == semantic_results[1]
    assert semantic_results[0]["matchedCandidate"] == left
    assert semantic_results[0]["unmatchedCandidate"] == [right]
    assert semantic_results[0]["maxScoreDelta"] == pytest.approx(0.1)


def test_compare_detections_does_not_match_duplicate_prediction_twice() -> None:
    reference = [{"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.9}]
    candidate = [
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.9},
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.8},
    ]

    result = compare_detections(reference, candidate)

    assert result["matchedCount"] == 1
    assert result["unmatchedReferenceCount"] == 0
    assert result["unmatchedCandidateCount"] == 1
    assert len(result["unmatchedCandidate"]) == 1


@pytest.mark.parametrize(
    ("reference", "candidate", "expected"),
    [
        ([], [], (0, 0, 0)),
        ([{"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.9}], [], (0, 1, 0)),
        ([], [{"category_id": 1, "bbox": [0, 0, 10, 10], "score": 0.9}], (0, 0, 1)),
    ],
)
def test_compare_detections_handles_empty_sides(
    reference: list[dict], candidate: list[dict], expected: tuple[int, int, int]
) -> None:
    result = compare_detections(reference, candidate)

    assert (
        result["matchedCount"],
        result["unmatchedReferenceCount"],
        result["unmatchedCandidateCount"],
    ) == expected
    assert result["maxScoreDelta"] is None
    assert result["maxBboxDeltaPixels"] is None


@pytest.mark.parametrize(
    "detection",
    [
        {"category_id": 1, "bbox": [0, 0, float("nan"), 10], "score": 0.9},
        {"category_id": 1, "bbox": [0, 0, -1, 10], "score": 0.9},
        {"category_id": 1, "bbox": [0, 0, 10, 10], "score": float("nan")},
    ],
)
def test_compare_detections_rejects_non_finite_or_invalid_rows(detection: dict) -> None:
    with pytest.raises(ValueError):
        compare_detections([detection], [])


@pytest.mark.parametrize(
    ("predictions", "expected_ap"),
    [(_perfect_predictions(), 1.0), ([], 0.0)],
    ids=["完美预测", "空预测"],
)
def test_cli_writes_utf8_coco_report(
    tmp_path: Path, predictions: list[dict], expected_ap: float
) -> None:
    annotations_path = tmp_path / "annotations.json"
    predictions_path = tmp_path / "predictions.json"
    image_ids_path = tmp_path / "image-ids.json"
    output_path = tmp_path / "结果.json"
    annotations_path.write_text(json.dumps(_annotations(), ensure_ascii=False), encoding="utf-8")
    predictions_path.write_text(json.dumps(predictions), encoding="utf-8")
    image_ids_path.write_text(json.dumps([10, 20]), encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "evaluation.cli",
            "coco",
            "--annotations",
            str(annotations_path),
            "--predictions",
            str(predictions_path),
            "--image-ids",
            str(image_ids_path),
            "--output",
            str(output_path),
        ],
        cwd=Path(__file__).parents[1],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONUTF8": "1"},
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["metrics"]["AP"] == pytest.approx(expected_ap)


def test_cli_returns_nonzero_for_invalid_consumer_input(tmp_path: Path) -> None:
    annotations_path = tmp_path / "annotations.json"
    predictions_path = tmp_path / "predictions.json"
    image_ids_path = tmp_path / "image-ids.json"
    annotations_path.write_text(json.dumps(_annotations(), ensure_ascii=False), encoding="utf-8")
    predictions_path.write_text(json.dumps(_perfect_predictions()), encoding="utf-8")
    image_ids_path.write_text("{}", encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "evaluation.cli",
            "coco",
            "--annotations",
            str(annotations_path),
            "--predictions",
            str(predictions_path),
            "--image-ids",
            str(image_ids_path),
            "--output",
            str(tmp_path / "result.json"),
        ],
        cwd=Path(__file__).parents[1],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONUTF8": "1"},
        check=False,
    )

    assert completed.returncode != 0
    assert "错误" in completed.stderr
