from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .coco import evaluate_coco


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="目标检测评测工具")
    subparsers = parser.add_subparsers(dest="command", required=True)
    coco = subparsers.add_parser("coco", help="运行 COCO bbox 质量评测")
    coco.add_argument(
        "--annotations", type=Path, required=True, help="COCO 标注 JSON"
    )
    coco.add_argument(
        "--predictions", type=Path, required=True, help="COCO 预测 JSON"
    )
    coco.add_argument(
        "--image-ids", type=Path, required=True, help="图片 ID JSON 数组"
    )
    coco.add_argument("--output", type=Path, required=True, help="输出报告 JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "coco":
            report = evaluate_coco(
                _read_json(args.annotations),
                _read_json(args.predictions),
                _read_json(args.image_ids),
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            return 0
    except (OSError, json.JSONDecodeError, TypeError, ValueError, KeyError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2
    parser.error("未知子命令")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
