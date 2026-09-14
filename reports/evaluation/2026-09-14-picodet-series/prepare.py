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
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for size, resolution in MODELS:
        url = f"https://paddledet.bj.bcebos.com/deploy/third_engine/picodet_{size}_{resolution}_lcnet_postprocessed.onnx"
        source = OUT / f"picodet-{size}-{resolution}-official.onnx"
        if not source.exists():
            urllib.request.urlretrieve(url, source)
        candidate = OUT / f"picodet-{size}-{resolution}-fp32.onnx"
        sanitize_postprocessed_model(source, candidate, input_size=resolution)
        inspect_onnx(candidate, input_size=resolution)
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        jobs.append({"key": f"picodet-{size}-{resolution}", "model": str(candidate.relative_to(ROOT)).replace("\\", "/"), "manifest": f"models/pp-detection/picodet-{size}-{resolution}/manifest.json", "bytes": candidate.stat().st_size, "sha256": digest, "inputSize": resolution, "sourceModel": str(source.relative_to(ROOT)).replace("\\", "/")})
    reference = ROOT / "models" / "pp-detection" / "picodet-l-320-fp32.onnx"
    if reference.is_file():
        jobs.append({"key": "picodet-l-320", "model": "models/pp-detection/picodet-l-320-fp32.onnx", "manifest": "models/pp-detection/1.0.2/manifest.json", "bytes": reference.stat().st_size, "sha256": hashlib.sha256(reference.read_bytes()).hexdigest(), "inputSize": 320, "sourceModel": "models/pp-detection/picodet-l-320-fp32.onnx"})
    (Path(__file__).parent / "jobs.json").write_text(json.dumps(jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
