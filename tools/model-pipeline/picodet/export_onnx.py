from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

def _find_file(model_dir: Path, suffixes: tuple[str, ...]) -> Path:
    matches = sorted(path for suffix in suffixes for path in model_dir.rglob(f"*{suffix}") if path.is_file())
    if not matches:
        raise FileNotFoundError(f"模型目录缺少文件: {', '.join(suffixes)}")
    return matches[0]


def _export_fp32(model_dir: Path, output: Path) -> None:
    config = _find_file(model_dir, (".yml", ".yaml"))
    weights = _find_file(model_dir, (".pdparams", ".pdiparams"))
    candidates = [
        model_dir / "tools" / "export_model.py",
        model_dir / "PaddleDetection" / "tools" / "export_model.py",
        model_dir.parent / "PaddleDetection" / "tools" / "export_model.py",
    ]
    export_script = next((path for path in candidates if path.is_file()), None)
    if export_script is None:
        raise FileNotFoundError("未找到 PaddleDetection 2.9 tools/export_model.py")
    with tempfile.TemporaryDirectory(prefix="picodet-export-") as temporary:
        export_dir = Path(temporary)
        command = [
            sys.executable,
            str(export_script),
            "-c",
            str(config),
            "-o",
            f"weights={weights}",
            "--output_dir",
            str(export_dir),
        ]
        subprocess.run(command, check=True, cwd=export_script.parent.parent)
        pdmodel = _find_file(export_dir, (".pdmodel",))
        pdparams = _find_file(export_dir, (".pdiparams",))
        paddle2onnx = shutil.which("paddle2onnx")
        if paddle2onnx is None:
            raise RuntimeError("缺少 paddle2onnx 命令，请安装固定版本依赖")
        output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                paddle2onnx,
                "--model_dir",
                str(pdmodel.parent),
                "--model_filename",
                pdmodel.name,
                "--params_filename",
                pdparams.name,
                "--save_file",
                str(output),
                "--opset_version",
                "11",
            ],
            check=True,
        )


FP16_SUPPORTED_OPS = {
    "Add", "BatchNormalization", "Cast", "Clip", "Concat", "Constant", "Conv", "Div", "Flatten", "Gather",
    "Gemm", "MatMul", "MaxPool", "Mul", "NonMaxSuppression", "Pad", "Pow", "ReduceMean", "ReduceSum", "Relu",
    "Reshape", "Resize", "Shape", "Sigmoid", "Slice", "Softmax", "Squeeze", "Sub", "Transpose", "Unsqueeze",
}


def _convert_fp16(source: Path, output: Path) -> None:
    try:
        import onnx
        from onnxconverter_common import float16
    except ImportError as exc:
        raise RuntimeError("FP16 转换需要 onnx 和 onnxconverter-common") from exc
    model = onnx.load(source, load_external_data=False)
    unsupported = sorted({node.op_type for node in model.graph.node if node.op_type not in FP16_SUPPORTED_OPS})
    if unsupported:
        raise RuntimeError("FP16 转换发现不支持节点: " + ", ".join(unsupported))
    converted = float16.convert_float_to_float16(model, keep_io_types=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(converted, output)


def export_onnx(*, model_dir: Path, output: Path, precision: str = "fp32") -> None:
    missing = [name for name in ("paddle", "paddle2onnx") if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError("缺少导出依赖: " + ", ".join(missing))
    if precision not in {"fp32", "fp16"}:
        raise ValueError("precision 必须为 fp32 或 fp16")
    if not model_dir.is_dir():
        raise FileNotFoundError(model_dir)
    if precision == "fp32":
        _export_fp32(model_dir, output)
        return
    with tempfile.TemporaryDirectory(prefix="picodet-fp16-") as temporary:
        fp32_path = Path(temporary) / "model.onnx"
        _export_fp32(model_dir, fp32_path)
        _convert_fp16(fp32_path, output)

def main() -> int:
    parser = argparse.ArgumentParser(description="导出 PicoDet-L-320 ONNX（opset 11）")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--precision", choices=("fp32", "fp16"), default="fp32")
    args = parser.parse_args()
    try:
        export_onnx(model_dir=args.model_dir.resolve(), output=args.output.resolve(), precision=args.precision)
    except Exception as exc:
        print(f"导出失败: {exc}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
