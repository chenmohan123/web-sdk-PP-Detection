from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


MEAN_VALUES = [0.485, 0.456, 0.406]
STD_VALUES = [0.229, 0.224, 0.225]
MEAN = np.asarray(MEAN_VALUES, dtype=np.float32)
STD = np.asarray(STD_VALUES, dtype=np.float32)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_input(path: Path, *, size: tuple[int, int]) -> tuple[np.ndarray, dict[str, Any]]:
    """按照 PicoDet TestReader 的 stretch + RGB/CHW + 标准化规则准备输入。"""
    with Image.open(path) as opened:
        image = opened.convert("RGB")
        width, height = image.size
        resized = image.resize(size, Image.Resampling.BICUBIC)
        pixels = np.asarray(resized, dtype=np.float32) / 255.0
    chw = np.transpose((pixels - MEAN) / STD, (2, 0, 1))[None, ...].astype(
        np.float32, copy=False
    )
    return chw, {
        "width": width,
        "height": height,
        "resizedWidth": size[0],
        "resizedHeight": size[1],
        "resizeMode": "stretch",
        "rescaleFactor": 1 / 255,
        "mean": MEAN_VALUES,
        "std": STD_VALUES,
    }


def _detection_matrix(outputs: dict[str, np.ndarray]) -> tuple[str, np.ndarray] | None:
    matches = [
        (name, value)
        for name, value in outputs.items()
        if value.ndim == 2 and value.shape[-1] == 6
    ]
    return matches[0] if len(matches) == 1 else None


def _count_output(outputs: dict[str, np.ndarray]) -> tuple[str, np.ndarray] | None:
    matches = [
        (name, value)
        for name, value in outputs.items()
        if value.ndim == 1 and np.issubdtype(value.dtype, np.integer)
    ]
    return matches[0] if len(matches) == 1 else None


def compare_outputs(
    reference: dict[str, np.ndarray], candidate: dict[str, np.ndarray]
) -> dict[str, Any]:
    """比较原始与清理模型的检测矩阵；异常 count 只记录，不参与检测数量。"""
    reference_matrix = _detection_matrix(reference)
    candidate_matrix = _detection_matrix(candidate)
    if reference_matrix is None or candidate_matrix is None:
        return {"pass": False, "reason": "原始或清理模型缺少唯一的检测矩阵输出"}

    reference_name, reference_values = reference_matrix
    candidate_name, candidate_values = candidate_matrix
    same_shape = reference_values.shape == candidate_values.shape
    if not same_shape:
        matrix = {
            "referenceOutput": reference_name,
            "candidateOutput": candidate_name,
            "shape": {
                "reference": list(reference_values.shape),
                "candidate": list(candidate_values.shape),
            },
            "pass": False,
        }
        return {"matrix": matrix, "pass": False, "reason": "检测矩阵形状不一致"}

    reference_values = np.asarray(reference_values, dtype=np.float64)
    candidate_values = np.asarray(candidate_values, dtype=np.float64)
    class_equal = np.array_equal(
        np.trunc(reference_values[:, 0]).astype(np.int64),
        np.trunc(candidate_values[:, 0]).astype(np.int64),
    )
    score_delta = np.abs(reference_values[:, 1] - candidate_values[:, 1])
    coordinate_delta = np.abs(reference_values[:, 2:6] - candidate_values[:, 2:6])
    finite = bool(np.isfinite(reference_values).all() and np.isfinite(candidate_values).all())
    matrix_pass = bool(
        finite and class_equal and np.max(score_delta, initial=0.0) <= 1e-3 and np.max(coordinate_delta, initial=0.0) <= 1e-3
    )

    reference_count = _count_output(reference)
    candidate_count = _count_output(candidate)
    count: dict[str, Any] = {"status": "missing"}
    if reference_count is not None and candidate_count is not None:
        reference_count_value = int(reference_count[1].reshape(-1)[0])
        candidate_count_value = int(candidate_count[1].reshape(-1)[0])
        count = {
            "status": "consistent_ignored" if reference_count_value == candidate_count_value else "inconsistent_ignored",
            "referenceOutput": reference_count[0],
            "candidateOutput": candidate_count[0],
            "referenceValue": reference_count_value,
            "candidateValue": candidate_count_value,
            "reason": "PicoDet 导出 count 与检测矩阵行数不一致，因此不作为有效检测数量",
        }

    return {
        "matrix": {
            "referenceOutput": reference_name,
            "candidateOutput": candidate_name,
            "rowCount": {"reference": int(reference_values.shape[0]), "candidate": int(candidate_values.shape[0])},
            "classSequenceEqual": class_equal,
            "finite": finite,
            "maxScoreDelta": float(np.max(score_delta, initial=0.0)),
            "maxCoordinateDeltaPixels": float(np.max(coordinate_delta, initial=0.0)),
            "pass": matrix_pass,
        },
        "count": count,
        "pass": matrix_pass,
    }


def _run(model_path: Path, image: np.ndarray) -> dict[str, np.ndarray]:
    import onnxruntime as ort

    session_options = ort.SessionOptions()
    session_options.log_severity_level = 3
    session = ort.InferenceSession(
        str(model_path), session_options, providers=["CPUExecutionProvider"]
    )
    inputs = {session.get_inputs()[0].name: image}
    if any(item.name == "scale_factor" for item in session.get_inputs()):
        inputs["scale_factor"] = np.asarray([[1.0, 1.0]], dtype=np.float32)
    values = session.run(None, inputs)
    return {output.name: value for output, value in zip(session.get_outputs(), values, strict=True)}


def build_report(reference_path: Path, candidate_path: Path, image_path: Path) -> dict[str, Any]:
    image, preprocessing = prepare_input(image_path, size=(320, 320))
    reference = _run(reference_path, image)
    candidate = _run(candidate_path, image)
    comparison = compare_outputs(reference, candidate)
    return {
        "schemaVersion": 1,
        "status": "passed" if comparison["pass"] else "failed",
        "model": {
            "reference": {"path": str(reference_path), "bytes": reference_path.stat().st_size, "sha256": sha256_file(reference_path)},
            "candidate": {"path": str(candidate_path), "bytes": candidate_path.stat().st_size, "sha256": sha256_file(candidate_path)},
        },
        "fixture": {"path": str(image_path), "bytes": image_path.stat().st_size, "sha256": sha256_file(image_path)},
        "preprocessing": preprocessing,
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "outputs": {
            "reference": {name: {"shape": list(value.shape), "dtype": str(value.dtype)} for name, value in reference.items()},
            "candidate": {name: {"shape": list(value.shape), "dtype": str(value.dtype)} for name, value in candidate.items()},
        },
        "comparison": comparison,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="比较 PicoDet 原始与清理 ONNX 输出")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build_report(args.reference.resolve(), args.candidate.resolve(), args.image.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
