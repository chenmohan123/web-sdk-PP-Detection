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
MODEL_VARIANTS = {
    "s": {"config": "configs/ppyoloe/ppyoloe_plus_crn_s_80e_coco.yml", "export_name": "ppyoloe_plus_crn_s_80e_coco", "weight_url": "https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_s_80e_coco.pdparams"},
    "m": {"config": "configs/ppyoloe/ppyoloe_plus_crn_m_80e_coco.yml", "export_name": "ppyoloe_plus_crn_m_80e_coco", "weight_bytes": 96769306, "weight_sha256": "3470057adb1eeb1d01c898e3ac944c1346533fefcd617044e75ffdfeb1df8528", "config_bytes": 409, "config_sha256": "163c7e3120d01f334c3087a72f5d49908900085fa2ad6e279588cb6375058b54", "weight_url": "https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_m_80e_coco.pdparams"},
    "l": {"config": "configs/ppyoloe/ppyoloe_plus_crn_l_80e_coco.yml", "export_name": "ppyoloe_plus_crn_l_80e_coco", "weight_bytes": 216672732, "weight_sha256": "4348bb04b0c23b6b815dbc1e05eca22ad62fdf9c42192a600d37497ca4023c88", "config_bytes": 407, "config_sha256": "5101704c3f5a7fa2ec1f6a6f3843bf031a608dd4a4405b67d93d6a90abf924e7", "weight_url": "https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_l_80e_coco.pdparams"},
    "x": {"config": "configs/ppyoloe/ppyoloe_plus_crn_x_80e_coco.yml", "export_name": "ppyoloe_plus_crn_x_80e_coco", "weight_bytes": 409840250, "weight_sha256": "83282fb62131a72e4538ec16c45739bec444da2ac849bccff5dfd69da3dd9fca", "config_bytes": 409, "config_sha256": "8e976f4e4028fe0bc3995f0abb76fabe074f00742a33529df680cdfa5e771f25", "weight_url": "https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_x_80e_coco.pdparams"},
}


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


def export_paddle(*, upstream: Path, weights: Path, output_dir: Path, temp_dir: Path, variant: str = "s") -> Path:
    if variant not in MODEL_VARIANTS:
        raise ValueError(f"不支持的 PP-YOLOE+ 规格：{variant}，可选 s/m/l/x")
    selected = MODEL_VARIANTS[variant]
    expected_name = f"PaddleDetection-{UPSTREAM_REVISION}"
    if upstream.name != expected_name:
        raise ValueError(f"上游目录必须固定为 {expected_name}")
    if variant == "s":
        lock_path = Path(__file__).resolve().parents[3] / "reports/evaluation/2026-09-11-ppyoloe/sources.lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        weight_source = next(item for item in lock["files"] if item["id"] == "weights")
        verify_file(weights, expected_bytes=weight_source["bytes"], expected_sha256=weight_source["sha256"])
        source_files = lock["sourceFiles"]
        for source in source_files:
            verify_file(upstream / source["path"], expected_bytes=source["bytes"], expected_sha256=source["sha256"])
    else:
        verify_file(weights, expected_bytes=selected["weight_bytes"], expected_sha256=selected["weight_sha256"])
        verify_file(upstream / selected["config"], expected_bytes=selected["config_bytes"], expected_sha256=selected["config_sha256"])
        reader = upstream / "configs/ppyoloe/_base_/ppyoloe_plus_reader.yml"
        verify_file(reader, expected_bytes=1236, expected_sha256="f99136e96213a9482d25a8e66b6d3e083e147a7632efd304fcff411f5d69e0cc")
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
            selected["config"],
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
    return output_dir / selected["export_name"]


def main() -> int:
    parser = argparse.ArgumentParser(description="从固定 PaddleDetection 源码导出 PP-YOLOE+ S/M/L/X 并转换为 opset 11")
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--temp-dir", type=Path, required=True)
    parser.add_argument("--onnx-output", type=Path, required=True)
    parser.add_argument("--variant", choices=sorted(MODEL_VARIANTS), default="s", help="模型规格：s、m、l 或 x")
    args = parser.parse_args()
    try:
        exported = export_paddle(
            upstream=args.upstream.resolve(),
            weights=args.weights.resolve(),
            output_dir=args.output_dir.resolve(),
            temp_dir=args.temp_dir.resolve(),
            variant=args.variant,
        )
        subprocess.run(paddle2onnx_command(exported, args.onnx_output.resolve()), check=True)
    except Exception as exc:
        print(f"导出失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
