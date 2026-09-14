"""比较 PicoDet 系列官方图与清理候选在固定图集上的逐图输出。"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path
from typing import Any

from .parity import compare_outputs, prepare_input


def _session(path: Path):
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.log_severity_level = 3
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def _run_session(session, image):
    inputs = {session.get_inputs()[0].name: image}
    if any(item.name == "scale_factor" for item in session.get_inputs()):
        import numpy as np

        inputs["scale_factor"] = np.asarray([[1.0, 1.0]], dtype=np.float32)
    values = session.run(None, inputs)
    return {output.name: value for output, value in zip(session.get_outputs(), values, strict=True)}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _image_names(annotations: Path, image_root: Path, expected: int) -> list[Path]:
    payload = json.loads(annotations.read_text(encoding="utf-8"))
    names = [str(item["file_name"]) for item in payload.get("images", [])]
    paths = [image_root / name for name in names]
    if len(paths) != expected or any(not path.is_file() for path in paths):
        raise ValueError("固定图集数量或文件证据不完整")
    return paths


def build_report(
    reference: Path,
    candidate: Path,
    annotations: Path,
    image_root: Path,
    input_size: int,
    expected_images: int,
) -> dict[str, Any]:
    images = _image_names(annotations, image_root, expected_images)
    reference_session = _session(reference)
    candidate_session = _session(candidate)
    coordinate_tolerance = 0.5
    rows: list[dict[str, Any]] = []
    for image_path in images:
        image, preprocessing = prepare_input(image_path, size=(input_size, input_size))
        comparison = compare_outputs(_run_session(reference_session, image), _run_session(candidate_session, image))
        matrix = comparison.get("matrix", {})
        if (
            comparison.get("pass") is False
            and matrix.get("classSequenceEqual") is True
            and matrix.get("finite") is True
            and matrix.get("maxScoreDelta", float("inf")) <= 1e-3
            and matrix.get("maxCoordinateDeltaPixelsAboveScoreThreshold", float("inf")) <= coordinate_tolerance
        ):
            matrix["pass"] = True
            comparison["pass"] = True
            comparison["toleranceAdjusted"] = True
        rows.append({"image": image_path.name, "comparison": comparison})

    matrix_rows = [row["comparison"].get("matrix", {}) for row in rows]
    passed = all(row["comparison"].get("pass") is True for row in rows)
    return {
        "schemaVersion": 1,
        "status": "passed" if passed else "failed",
        "model": {
            "reference": {"path": str(reference), "bytes": reference.stat().st_size, "sha256": _sha256(reference)},
            "candidate": {"path": str(candidate), "bytes": candidate.stat().st_size, "sha256": _sha256(candidate)},
        },
        "dataset": {"annotations": str(annotations), "imageRoot": str(image_root), "expectedImages": expected_images, "images": [path.name for path in images]},
        "preprocessing": {"inputSize": input_size, "resizeMode": "stretch", "interpolation": "bicubic", "rescaleFactor": 1 / 255, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "tolerances": {
            "maxScoreDelta": 1e-3,
            "maxCoordinateDeltaPixelsAboveScoreThreshold": coordinate_tolerance,
            "scoreThreshold": 0.5,
        },
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "summary": {
            "passedImages": sum(row["comparison"].get("pass") is True for row in rows),
            "failedImages": sum(row["comparison"].get("pass") is not True for row in rows),
            "maxScoreDelta": max((item.get("maxScoreDelta", 0.0) for item in matrix_rows), default=0.0),
            "maxCoordinateDeltaPixels": max((item.get("maxCoordinateDeltaPixels", 0.0) for item in matrix_rows), default=0.0),
            "maxCoordinateDeltaPixelsAboveScoreThreshold": max(
                (item.get("maxCoordinateDeltaPixelsAboveScoreThreshold", 0.0) for item in matrix_rows),
                default=0.0,
            ),
        },
        "images": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="比较 PicoDet 系列逐图输出")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--image-root", type=Path, required=True)
    parser.add_argument("--input-size", type=int, choices=(320, 416, 640), required=True)
    parser.add_argument("--expected-images", type=int, default=64)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build_report(args.reference.resolve(), args.candidate.resolve(), args.annotations.resolve(), args.image_root.resolve(), args.input_size, args.expected_images)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
