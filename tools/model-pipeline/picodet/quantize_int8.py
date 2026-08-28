from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def validate_evidence(evidence: dict[str, Any]) -> None:
    required = ("python", "browserWasm", "memory", "timing", "accuracy")
    missing = [name for name in required if evidence.get(name) is not True]
    if missing:
        raise ValueError("INT8 stable 需要完整证据: " + ", ".join(missing))


def build_report(*, input_path: str, output_path: str, calibration_images: list[str], evidence: dict[str, Any]) -> dict[str, Any]:
    stable = True
    try:
        validate_evidence(evidence)
    except ValueError:
        stable = False
    return {
        "status": "stable" if stable else "labs",
        "method": "static-qdq",
        "input": input_path,
        "output": output_path,
        "calibrationImages": calibration_images,
        "evidence": evidence,
        "limitations": [] if stable else ["尚未同时通过 Python、浏览器 WASM、内存、耗时和精度证据"],
    }


class _CalibrationReader:
    def __init__(self, image_paths: list[Path], input_name: str) -> None:
        self.image_paths = image_paths
        self.input_name = input_name
        self.index = 0

    def get_next(self) -> dict[str, Any] | None:
        if self.index >= len(self.image_paths):
            return None
        try:
            import numpy as np
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError("INT8 校准需要 numpy、Pillow") from exc
        image = Image.open(self.image_paths[self.index]).convert("RGB").resize((320, 320))
        self.index += 1
        array = np.asarray(image, dtype=np.float32).transpose(2, 0, 1)[None, ...] / 255.0
        return {self.input_name: array}


def quantize(*, input_path: Path, output_path: Path, calibration_dir: Path, input_name: str = "image") -> dict[str, Any]:
    try:
        from onnxruntime.quantization import CalibrationMethod, QuantFormat, QuantType, quantize_static
    except ImportError as exc:
        raise RuntimeError("INT8 量化需要 onnxruntime") from exc
    images = sorted(path for path in calibration_dir.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not images:
        raise FileNotFoundError("校准目录没有 jpg/png 图片")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    quantize_static(
        str(input_path),
        str(output_path),
        _CalibrationReader(images, input_name),
        quant_format=QuantFormat.QDQ,
        per_channel=True,
        weight_type=QuantType.QInt8,
        activation_type=QuantType.QUInt8,
        calibrate_method=CalibrationMethod.MinMax,
    )
    return build_report(input_path=str(input_path), output_path=str(output_path), calibration_images=[str(path) for path in images], evidence={})


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 PicoDet INT8 实验产物")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--calibration-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = quantize(input_path=args.input.resolve(), output_path=args.output.resolve(), calibration_dir=args.calibration_dir.resolve())
    except Exception as exc:
        print(f"INT8 量化失败: {exc}", file=sys.stderr)
        return 1
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
