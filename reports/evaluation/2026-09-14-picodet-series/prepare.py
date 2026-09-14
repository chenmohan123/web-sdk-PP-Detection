"""下载并清理 PicoDet 官方后处理图，生成候选清单与 jobs.json。"""
from __future__ import annotations
import hashlib, json, urllib.request, sys
from pathlib import Path

ROOT = Path(__file__).parents[3]
OUT = ROOT / ".tmp" / "picodet-series"
MODELS = [(s, r) for s in ("xs", "s", "m") for r in (320, 416)] + [("l", 416), ("l", 640)]

def main() -> None:
    sys.path.insert(0, str(ROOT / "tools" / "model-pipeline"))
    from picodet.inspect_onnx import inspect_onnx
    from picodet.sanitize_onnx import sanitize_postprocessed_model
    from picodet.sanitize_webgpu_fp32 import sanitize_picodet_webgpu_fp32
    OUT.mkdir(parents=True, exist_ok=True)
    sources = json.loads((Path(__file__).parent / "sources.lock.json").read_text(encoding="utf-8"))
    source_by_key = {entry["key"]: entry for entry in sources["entries"]}

    def official_source(size, resolution):
        key = f"picodet-{size}-{resolution}"
        entry = source_by_key[key]
        source = OUT / f"{key}-official.onnx"
        if not source.exists():
            urllib.request.urlretrieve(entry["downloadUrl"], source)
        if source.stat().st_size != entry["bytes"] or hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"官方导出文件与固定来源不符：{key}")
        return source

    jobs = []
    for size, resolution in MODELS:
        source = official_source(size, resolution)
        candidate = OUT / f"picodet-{size}-{resolution}-fp32.onnx"
        base_candidate = OUT / f"picodet-{size}-{resolution}-base.onnx"
        sanitize_postprocessed_model(source, base_candidate, input_size=resolution)
        sanitize_picodet_webgpu_fp32(base_candidate, candidate)
        base_candidate.unlink(missing_ok=True)
        inspect_onnx(candidate, input_size=resolution)
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        jobs.append({"key": f"picodet-{size}-{resolution}", "model": str(candidate.relative_to(ROOT)).replace("\\", "/"), "manifest": f"models/pp-detection/picodet-{size}-{resolution}/manifest.json", "bytes": candidate.stat().st_size, "sha256": digest, "inputSize": resolution, "sourceModel": str(source.relative_to(ROOT)).replace("\\", "/")})
    reference = ROOT / "models" / "pp-detection" / "picodet-l-320-fp32.onnx"
    stable = json.loads((ROOT / "models/pp-detection/1.0.2/manifest.json").read_text(encoding="utf-8"))["variants"][0]
    if not reference.is_file() or reference.stat().st_size != stable["bytes"] or hashlib.sha256(reference.read_bytes()).hexdigest() != stable["sha256"]:
        raise ValueError("请先按 1.0.2 清单准备固定哈希的 L-320 FP32")
    original = official_source("l", 320)
    jobs.append({"key": "picodet-l-320", "model": "models/pp-detection/picodet-l-320-fp32.onnx", "manifest": "models/pp-detection/1.0.2/manifest.json", "bytes": reference.stat().st_size, "sha256": stable["sha256"], "inputSize": 320, "sourceModel": str(original.relative_to(ROOT)).replace("\\", "/")})
    (Path(__file__).parent / "jobs.json").write_text(json.dumps(jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
