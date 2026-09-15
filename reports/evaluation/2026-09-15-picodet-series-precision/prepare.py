"""生成 PicoDet 全系列 FP16/W8A32 实验候选及身份 jobs。

候选只写入 .tmp/picodet-series-precision，清单和转换报告写入本轮报告目录。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import onnx
import onnxruntime as ort
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OLD_JOBS = ROOT / "reports/evaluation/2026-09-14-picodet-series/jobs.json"
OUT = ROOT / ".tmp/picodet-series-precision"
REPORT = ROOT / "reports/evaluation/2026-09-15-picodet-series-precision"
PYTHON = Path("F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe")


def digest(path: Path) -> tuple[int, str]:
    data = path.read_bytes()
    return len(data), hashlib.sha256(data).hexdigest()


def inspect_model(path: Path, *, full_check: bool = True) -> dict:
    model = onnx.load(path)
    onnx.checker.check_model(model, full_check=full_check)
    inp = model.graph.input[0].type.tensor_type
    dims = [d.dim_value if d.dim_value else -1 for d in inp.shape.dim]
    outputs = [onnx.TensorProto.DataType.Name(x.type.tensor_type.elem_type) for x in model.graph.output]
    for tensor in list(model.graph.initializer):
        if tensor.data_type in (onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16):
            values = onnx.numpy_helper.to_array(tensor)
            if not np.isfinite(values).all():
                raise ValueError(f"候选包含非有限权重: {path} {tensor.name}")
    return {"input": dims, "inputDtype": onnx.TensorProto.DataType.Name(inp.elem_type), "outputDtypes": outputs,
            "opset": next(x.version for x in model.opset_import if x.domain == ""),
            "parameterCount": sum(int(np.prod(t.dims)) for t in model.graph.initializer)}


def is_reusable(report: Path, output: Path, *, key: str, precision: str, source_bytes: int, source_sha: str, configuration: dict) -> bool:
    try:
        r = json.loads(report.read_text(encoding="utf-8"))
        size, sha = digest(output)
        candidate = r.get("candidate", {})
        candidate_bytes = candidate.get("candidateBytes", candidate.get("output", {}).get("bytes"))
        candidate_sha = candidate.get("candidateSha256", candidate.get("output", {}).get("sha256"))
        return (r.get("key") == key and r.get("precision") == precision and
                r.get("sourceBytes") == source_bytes and r.get("sourceSha256") == source_sha and
                candidate_bytes == size and candidate_sha == sha and
                r.get("configuration", {"blockedNodes": r.get("candidate", {}).get("nodeBlockList", []),
                                         "excludeNodes": r.get("excludeNodes", [])}) == configuration)
    except (OSError, ValueError, json.JSONDecodeError):
        return False


def manifest_for(base: dict, key: str, precision: str, filename: str, size: int, sha: str, metadata: dict) -> dict:
    m = json.loads(json.dumps(base, ensure_ascii=False))
    m["status"] = "labs"
    m["defaultSource"] = "custom"
    m["model"]["version"] = "precision-2026-09-15"
    m["model"]["assets"] = [{"filename": filename, "bytes": size, "sha256": sha}]
    m["defaultVariant"] = precision
    m["limitations"] = ["仅为本地评测候选，尚未通过浏览器质量门槛或发布到模型 Hub。",
                         "本地来源只提供身份声明，评测通过 model.data 注入同 SHA 权重。"]
    variants = [{"id": precision, "filename": filename, "precision": "int8" if precision == "w8a32" else precision,
                     "quantization": "mixed-fp16-sensitive-ops-fp32" if precision == "fp16" else "weight-only-int8-activation-fp32",
                     "opset": metadata["opset"], "bytes": size, "sha256": sha, "parameterCount": metadata.get("parameterCount"),
                     "backends": ["wasm", "webgpu"], "status": "labs", "sources": [{
                         "kind": "custom", "repository": "local/picodet-series-precision-evaluation",
                         "revision": sha, "path": filename,
                         "downloadUrl": f"http://127.0.0.1:4173/{filename}", "bytes": size, "sha256": sha
                     }]}]
    m["variants"] = variants
    return m


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", choices=["all", "xs-s"], default="all")
    args = parser.parse_args()
    jobs = json.loads(OLD_JOBS.read_text(encoding="utf-8"))
    specs = [j for j in jobs if j["key"] != "picodet-l-320"]
    if args.limit == "xs-s":
        specs = [j for j in specs if j["key"].startswith(("picodet-xs", "picodet-s"))]
    sys.path.insert(0, str(ROOT / "tools/model-pipeline"))
    import float16_models  # type: ignore
    import weight_only  # type: ignore
    OUT.mkdir(parents=True, exist_ok=True)
    (REPORT / "manifests").mkdir(parents=True, exist_ok=True)
    generated = []
    archived_conversions = []
    for item in specs:
        key = item["key"]
        # 转换以已发布、可 full-check 的 FP32 图为输入；official 导出图仅作来源身份记录。
        source = ROOT / item["model"]
        source_bytes, source_sha = digest(source)
        if source_bytes != item["bytes"] or source_sha != item["sha256"]:
            raise ValueError(f"源模型身份异常: {key}")
        base_manifest = json.loads((ROOT / item["manifest"]).read_text(encoding="utf-8"))
        metadata = inspect_model(source, full_check=False)
        for precision in ("fp16", "w8a32"):
            filename = f"{key}-{precision}.onnx"
            output = OUT / filename
            conversion = output.with_suffix(".conversion.json")
            configuration = {"blockedNodes": ["Cast_5"] if precision == "fp16" else [],
                             "excludeNodes": ["Conv_0", "Conv_1"] if precision == "w8a32" else []}
            if not (output.exists() and conversion.exists() and is_reusable(conversion, output, key=key,
                    precision=precision, source_bytes=source_bytes, source_sha=source_sha, configuration=configuration)):
                if precision == "fp16":
                    report = float16_models.convert(source, output, expected_sha256=source_sha,
                                                    extra_blocked_ops=(), blocked_nodes=("Cast_5",))
                else:
                    report = weight_only.convert(source, output, expected_sha256=source_sha,
                                                 exclude_nodes=("Conv_0", "Conv_1"))
                conversion.write_text(json.dumps({"key": key, "precision": precision, "configuration": configuration,
                    "sourceModel": str(source.relative_to(ROOT)).replace("\\", "/"),
                    "sourceSha256": source_sha, "sourceBytes": source_bytes,
                    "excludeNodes": ["Conv_0", "Conv_1"] if precision == "w8a32" else [],
                    "candidate": report, "validation": inspect_model(output)},
                    ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            size, sha = digest(output)
            archived = REPORT / 'conversions' / conversion.name
            archived.parent.mkdir(exist_ok=True)
            archived.write_bytes(conversion.read_bytes())
            archived_size, archived_sha = digest(archived)
            archived_conversions.append({'path': archived.relative_to(REPORT).as_posix(), 'sha256': archived_sha, 'bytes': archived_size})
            candidate_meta = inspect_model(output)
            manifest = manifest_for(base_manifest, key, precision, filename, size, sha, candidate_meta)
            manifest_path = REPORT / "manifests" / f"{key}-{precision}.manifest.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            generated.append({"key": key, "precision": precision, "model": str(output.relative_to(ROOT)).replace("\\", "/"),
                              "manifest": str(manifest_path.relative_to(ROOT)).replace("\\", "/"),
                              "bytes": size, "sha256": sha, "inputSize": item["inputSize"],
                              "sourceModel": str(source.relative_to(ROOT)).replace("\\", "/"),
                              "sourceBytes": source_bytes, "sourceSha256": source_sha})
        generated.append({"key": key, "precision": "fp32", "model": item["model"], "manifest": item["manifest"],
                          "bytes": item["bytes"], "sha256": item["sha256"], "inputSize": item["inputSize"],
                          "sourceModel": item["model"], "sourceBytes": item["bytes"], "sourceSha256": item["sha256"]})
    generated.sort(key=lambda x: (x["key"], ("fp32", "fp16", "w8a32").index(x["precision"])))
    (REPORT / "jobs.json").write_text(json.dumps(generated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (REPORT / 'conversion-index.json').write_text(json.dumps(archived_conversions, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({"jobs": len(generated), "candidates": len(generated) - len(specs)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
