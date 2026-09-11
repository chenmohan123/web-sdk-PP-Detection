from __future__ import annotations

import argparse
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ppyoloe.sources import verify_file

UPSTREAM_REVISION = "b25522a0f4bde8c80603f3ba5e3472059972e3b5"
CONFIG = "configs/ppyoloe/ppyoloe_plus_crn_s_80e_coco.yml"


def paddle2onnx_command(exported_dir: Path, output: Path) -> list[str]:
    return [
        str(Path(sys.executable).parent / ("paddle2onnx.exe" if os.name == "nt" else "paddle2onnx")),
        "--model_dir",
        str(exported_dir),
        "--model_filename",
        "model.pdmodel",
        "--params_filename",
        "model.pdiparams",
        "--opset_version",
        "11",
        "--save_file",
        str(output),
    ]


def export_paddle(*, upstream: Path, weights: Path, output_dir: Path, temp_dir: Path) -> Path:
    expected_name = f"PaddleDetection-{UPSTREAM_REVISION}"
    if upstream.name != expected_name:
        raise ValueError(f"上游目录必须固定为 {expected_name}")
    lock_path = Path(__file__).resolve().parents[3] / "reports/evaluation/2026-09-11-ppyoloe/sources.lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    weight_source = next(item for item in lock["files"] if item["id"] == "weights")
    verify_file(weights, expected_bytes=weight_source["bytes"], expected_sha256=weight_source["sha256"])
    for source in lock["sourceFiles"]:
        verify_file(upstream / source["path"], expected_bytes=source["bytes"], expected_sha256=source["sha256"])
    temp_dir.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(temp_dir / "matplotlib")
    import paddle.jit.dy2static.utils as translator_utils

    def local_temp_dir() -> str:
        path = temp_dir / str(os.getpid())
        path.mkdir(parents=True, exist_ok=True)
        return str(path)

    translator_utils.get_temp_dir = local_temp_dir
    previous_cwd, previous_argv = Path.cwd(), sys.argv
    try:
        os.chdir(upstream)
        sys.path.insert(0, str(upstream))
        sys.argv = [
            str(upstream / "tools/export_model.py"),
            "-c",
            CONFIG,
            "-o",
            "use_gpu=False",
            f"weights={weights}",
            "TestReader.inputs_def.image_shape=[3,640,640]",
            "export_onnx=True",
            "--output_dir",
            str(output_dir),
        ]
        runpy.run_path(sys.argv[0], run_name="__main__")
    finally:
        os.chdir(previous_cwd)
        sys.argv = previous_argv
        if sys.path and sys.path[0] == str(upstream):
            sys.path.pop(0)
    return output_dir / "ppyoloe_plus_crn_s_80e_coco"


def main() -> int:
    parser = argparse.ArgumentParser(description="从固定 PaddleDetection 源码导出 PP-YOLOE+ S 并转换为 opset 11")
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--temp-dir", type=Path, required=True)
    parser.add_argument("--onnx-output", type=Path, required=True)
    args = parser.parse_args()
    try:
        exported = export_paddle(
            upstream=args.upstream.resolve(),
            weights=args.weights.resolve(),
            output_dir=args.output_dir.resolve(),
            temp_dir=args.temp_dir.resolve(),
        )
        subprocess.run(paddle2onnx_command(exported, args.onnx_output.resolve()), check=True)
    except Exception as exc:
        print(f"导出失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
