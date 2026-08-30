from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import onnx
from onnxconverter_common.float16 import convert_float_to_float16

try:
    from .parity import build_report
except ImportError:  # 直接以脚本路径执行时的导入兼容
    from parity import build_report


# PicoDet 的后处理边界在 CPU ORT 和浏览器 ORT 中都需要保持 FP32。
DEFAULT_BLOCKED_OPS = ("NonMaxSuppression", "Resize")
DEFAULT_BLOCKED_NODES = ("Cast_5",)
DEFAULT_FIXTURE_DIR = Path(__file__).parents[1] / "fixtures" / "images"


@dataclass(frozen=True)
class ConversionPlan:
    blocked_ops: tuple[str, ...]
    blocked_nodes: tuple[str, ...]


def _static_shape(value: onnx.ValueInfoProto) -> tuple[int, ...] | None:
    tensor = value.type.tensor_type
    if not tensor.HasField("shape"):
        return None
    dimensions: list[int] = []
    for dimension in tensor.shape.dim:
        if not dimension.HasField("dim_value"):
            return None
        dimensions.append(dimension.dim_value)
    return tuple(dimensions)


def build_conversion_plan(model: onnx.ModelProto) -> ConversionPlan:
    """校验 PicoDet 图并返回唯一、可复现的 FP16 转换边界。"""
    image_inputs = [value for value in model.graph.input if value.name == "image"]
    if len(image_inputs) != 1:
        raise ValueError("输入图不是受支持的 PicoDet 模型：缺少 image 输入")
    image = image_inputs[0]
    tensor = image.type.tensor_type
    if tensor.elem_type != onnx.TensorProto.FLOAT or _static_shape(image) != (1, 3, 320, 320):
        raise ValueError("输入图不是受支持的 PicoDet 模型：image 必须是 [1,3,320,320] float32")

    op_types = {node.op_type for node in model.graph.node}
    missing_ops = sorted(set(DEFAULT_BLOCKED_OPS) - op_types)
    if missing_ops:
        raise ValueError(f"输入图不是受支持的 PicoDet 模型：缺少 {', '.join(missing_ops)} 节点")

    node_names = {node.name for node in model.graph.node}
    missing_nodes = sorted(set(DEFAULT_BLOCKED_NODES) - node_names)
    if missing_nodes:
        raise ValueError(f"输入图不是受支持的 PicoDet 模型：缺少 {', '.join(missing_nodes)} 节点")

    return ConversionPlan(DEFAULT_BLOCKED_OPS, DEFAULT_BLOCKED_NODES)


def _load_cpu_session(model_path: Path) -> None:
    try:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.log_severity_level = 3
        ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
    except Exception as exc:
        raise ValueError(f"FP16 模型无法由 CPU ONNX Runtime 加载：{exc}") from exc


def validate_fixture_parity(
    reference_path: Path, candidate_path: Path, fixture_dir: Path
) -> None:
    fixtures = sorted(
        path
        for path in fixture_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    if not fixtures:
        raise ValueError("FP16 parity 校验失败：fixture 目录没有图片")

    failures: list[str] = []
    for fixture in fixtures:
        try:
            report = build_report(reference_path, candidate_path, fixture)
        except Exception as exc:
            failures.append(f"{fixture.name}: {exc}")
            continue
        if report["status"] != "passed":
            comparison = report.get("comparison", {})
            matrix = comparison.get("matrix", {})
            failures.append(
                f"{fixture.name}: score={matrix.get('maxScoreDelta')}, "
                f"坐标={matrix.get('maxCoordinateDeltaPixels')}, "
                f"类别一致={matrix.get('classSequenceEqual')}"
            )
    if failures:
        raise ValueError("FP16 parity 校验失败：" + "; ".join(failures))


def convert_fp16(
    source_path: Path,
    output_path: Path,
    *,
    fixtures_dir: Path = DEFAULT_FIXTURE_DIR,
) -> ConversionPlan:
    """转换 PicoDet FP16；所有检查通过后才替换最终输出文件。"""
    source_path = source_path.resolve()
    output_path = output_path.resolve()
    model = onnx.load(source_path, load_external_data=False)
    plan = build_conversion_plan(model)
    converted = convert_float_to_float16(
        model,
        keep_io_types=True,
        op_block_list=list(plan.blocked_ops),
        node_block_list=list(plan.blocked_nodes),
    )

    onnx.checker.check_model(converted)
    temporary_path = output_path.with_name(output_path.name + ".tmp")
    if temporary_path.exists():
        temporary_path.unlink()
    try:
        temporary_path.parent.mkdir(parents=True, exist_ok=True)
        onnx.save_model(converted, temporary_path, save_as_external_data=False)
        onnx.checker.check_model(temporary_path)
        _load_cpu_session(temporary_path)
        if temporary_path.stat().st_size >= source_path.stat().st_size:
            raise ValueError("FP16 模型未小于 FP32 源模型")
        if not any(
            initializer.data_type == onnx.TensorProto.FLOAT16
            for initializer in converted.graph.initializer
        ):
            raise ValueError("FP16 模型没有 float16 权重")
        if any(
            initializer.data_type == onnx.TensorProto.DOUBLE
            for initializer in converted.graph.initializer
        ):
            raise ValueError("FP16 模型仍包含 double 权重")
        validate_fixture_parity(source_path, temporary_path, fixtures_dir.resolve())
        os.replace(temporary_path, output_path)
    except Exception:
        if temporary_path.exists():
            temporary_path.unlink()
        raise
    return plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="转换 PicoDet ONNX 为 FP16")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--fixtures-dir", type=Path, default=DEFAULT_FIXTURE_DIR)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        plan = convert_fp16(args.source, args.output, fixtures_dir=args.fixtures_dir)
    except Exception as exc:
        print(f"PicoDet FP16 转换失败：{exc}", file=sys.stderr)
        return 1
    print(f"已生成 {args.output}；阻塞算子：{', '.join(plan.blocked_ops)}；阻塞节点：{', '.join(plan.blocked_nodes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
