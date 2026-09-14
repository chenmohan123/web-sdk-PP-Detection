"""根据实际候选图生成已验收的 PicoDet 系列稳定清单。"""

import copy
import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools/model-pipeline"))
inspect_onnx = importlib.import_module("picodet.inspect_onnx").inspect_onnx

SOURCES = (
    ("modelscope", "https://www.modelscope.cn", "39739aafe769e1fc2843bc9f7bd3b6c3512e217a"),
    ("huggingface", "https://huggingface.co", "aeebbf3b839ee187a20f8e2388e85ee0bc6aa8d3"),
)


def main() -> None:
    jobs = json.loads((REPORT_ROOT / "jobs.json").read_text(encoding="utf-8"))
    base = json.loads((ROOT / "models/pp-detection/1.0.2/manifest.json").read_text(encoding="utf-8"))
    for job in jobs:
        if job["key"] == "picodet-l-320":
            continue
        key = job["key"]
        size = job["inputSize"]
        filename = f"{key}-fp32.onnx"
        identity = inspect_onnx(ROOT / job["model"], input_size=size)
        if (identity["bytes"], identity["sha256"]) != (job["bytes"], job["sha256"]):
            raise ValueError(f"候选文件与评测身份不符：{key}")
        manifest = copy.deepcopy(base)
        manifest["model"] = {
            "id": f"pp-{key}", "version": "1.0.0",
            "architecture": f"PicoDet-{key.split('-')[1].upper()}-{size} LCNet",
            "format": "onnx",
            "assets": [{"filename": filename, "bytes": identity["bytes"], "sha256": identity["sha256"]}],
        }
        manifest["input"] = identity["input"]
        manifest["outputs"] = identity["outputs"]
        manifest["preprocessing"]["size"] = {"width": size, "height": size}
        variant = manifest["variants"][0]
        variant.update({name: identity[name] for name in ("bytes", "sha256", "parameterCount", "opset")})
        variant["filename"] = filename
        variant["sources"] = []
        path = f"{key}/1.0.0/{filename}"
        repository = "chenmohan/web-sdk-pp-detection"
        for kind, host, revision in SOURCES:
            prefix = "/models" if kind == "modelscope" else ""
            variant["sources"].append({
                "kind": kind, "repository": repository, "revision": revision, "path": path,
                "downloadUrl": f"{host}{prefix}/{repository}/resolve/{revision}/{path}",
                "bytes": identity["bytes"], "sha256": identity["sha256"],
            })
        manifest["variants"] = [variant]
        manifest["limitations"] = [
            "2026-09-15 已在 Windows 11 Chromium 153 的 WASM 与物理 NVIDIA WebGPU 环境验证；不代表所有浏览器、设备或 NPU 均兼容。",
            "模型由 PaddleDetection 官方导出图经兼容清理生成，许可沿用上游 Apache-2.0。参数量按 ONNX initializer 元素统计，包含图内常量。",
        ]
        destination = ROOT / job["manifest"]
        destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()