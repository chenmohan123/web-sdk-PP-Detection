from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from .inspect_onnx import inspect_onnx
    from .source_evidence import order_sources, validate_source
except ImportError:  # 直接以脚本路径执行时的导入兼容
    from inspect_onnx import inspect_onnx
    from source_evidence import order_sources, validate_source

ROOT = Path(__file__).parents[3]
SOURCE_KINDS = {"git-lfs", "huggingface", "modelscope"}


def validate_sources(sources: list[dict[str, Any]], *, artifact_bytes: int, artifact_sha256: str) -> None:
    kinds = {source.get("kind") for source in sources}
    if kinds != SOURCE_KINDS:
        raise ValueError("稳定变体必须提供 git-lfs、huggingface、modelscope 三类真实来源")
    for source in sources:
        if not isinstance(source.get("repository"), str) or not source["repository"].strip():
            raise ValueError("来源 repository 不能为空")
        if not isinstance(source.get("path"), str) or not source["path"].strip():
            raise ValueError("来源 path 不能为空")
        revision = source.get("revision")
        if not isinstance(revision, str) or re.fullmatch(r"[0-9a-fA-F]{40,64}", revision) is None:
            raise ValueError("来源 revision 必须是 40 至 64 位十六进制值")
        parsed = urlparse(str(source.get("downloadUrl", "")))
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("来源 downloadUrl 必须是带主机的 HTTP(S) 地址")
        if not isinstance(source.get("bytes"), int) or source["bytes"] < 1:
            raise ValueError("来源 bytes 必须是正整数")
        if not isinstance(source.get("sha256"), str) or re.fullmatch(r"[0-9a-fA-F]{64}", source["sha256"]) is None:
            raise ValueError("来源 sha256 必须是 64 位十六进制值")
        validate_source(source, artifact_bytes, artifact_sha256)

def canonical_json(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _validate_source_kinds(sources: list[dict[str, Any]]) -> None:
    kinds = {source.get("kind") for source in sources}
    if kinds != SOURCE_KINDS:
        raise ValueError("来源必须包含 git-lfs、huggingface、modelscope 三类真实来源")

def build_manifest(*, artifact_dir: Path, model_version: str, source_evidence: list[dict[str, Any]] | dict[str, list[dict[str, Any]]] | None) -> dict[str, Any]:
    if not source_evidence:
        return {
            "schemaVersion": 1,
            "status": "labs/blocked",
            "model": {
                "id": "pp-picodet-l-320",
                "version": model_version,
                "architecture": "PicoDet-L-320 LCNet",
                "format": "onnx",
            },
            "input": {"name": "image", "shape": [1, 3, 320, 320], "dtype": "float32"},
            "variants": [],
            "sources": [],
            "labels": "labels/coco.txt",
            "blocked": {
                "reason": "模型文件已生成，但外部来源证据未满足 Git LFS、Hugging Face、ModelScope 三类来源要求",
                "evidence": "tools/model-pipeline/reports/picodet-sanitize.json",
            },
        }
    variants: list[dict[str, Any]] = []
    if source_evidence is not None:
        evidence_by_precision = source_evidence if isinstance(source_evidence, dict) else {"fp32": source_evidence, "fp16": source_evidence}
        for precision, sources in evidence_by_precision.items():
            evidence_by_precision[precision] = order_sources(sources)
    for precision in ("fp16", "fp32"):
        path = artifact_dir / f"picodet-l-320-{precision}.onnx"
        if not path.is_file():
            continue
        metadata = inspect_onnx(path)
        variant_sources = source_evidence.get(precision, []) if isinstance(source_evidence, dict) else (source_evidence or [])
        variant_sources = order_sources(variant_sources)
        variants.append({"id": precision, "filename": path.name, "precision": precision, "quantization": "none", "opset": metadata["opset"], "bytes": metadata["bytes"], "sha256": metadata["sha256"], "parameterCount": metadata["parameterCount"], "backends": ["wasm", "webgpu"], "sources": variant_sources})
    if variants:
        for variant in variants:
            validate_sources(variant["sources"], artifact_bytes=variant["bytes"], artifact_sha256=variant["sha256"])
    flattened_sources = source_evidence if isinstance(source_evidence, list) else []
    result: dict[str, Any] = {"schemaVersion": 1, "status": "stable" if variants else "labs/blocked", "model": {"id": "pp-picodet-l-320", "version": model_version, "architecture": "PicoDet-L-320 LCNet", "format": "onnx"}, "input": {"name": "image", "shape": [1, 3, 320, 320], "dtype": "float32"}, "variants": sorted(variants, key=lambda item: item["id"]), "sources": flattened_sources, "labels": "labels/coco.txt"}
    if not variants:
        result["blocked"] = {"reason": "官方 PicoDet-L-320 权重或导出工具不可用，尚未生成可验证 ONNX 文件", "evidence": "tools/model-pipeline/reports/picodet-blocked.json"}
    return result

def main() -> None:
    parser = argparse.ArgumentParser(description="从真实 PicoDet ONNX 文件生成 manifest")
    parser.add_argument("--artifact-dir", type=Path, default=ROOT / "models" / "pp-detection" / "1.0.0")
    parser.add_argument("--model-version", default="1.0.0")
    parser.add_argument("--sources", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "models" / "pp-detection" / "1.0.0" / "manifest.json")
    args = parser.parse_args()
    evidence = json.loads(args.sources.read_text(encoding="utf-8")) if args.sources else None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json(build_manifest(artifact_dir=args.artifact_dir.resolve(), model_version=args.model_version, source_evidence=evidence)))

if __name__ == "__main__":
    main()
