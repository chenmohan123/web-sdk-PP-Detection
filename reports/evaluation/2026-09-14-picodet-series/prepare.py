"""下载并清理 PicoDet 官方后处理图，生成候选清单与 jobs.json。"""
from __future__ import annotations
import hashlib, json, urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[4]
OUT = ROOT / ".tmp" / "picodet-series"
MODELS = [(s, r) for s in ("xs", "s", "m") for r in (320, 416)] + [("l", 416), ("l", 640)]

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for size, resolution in MODELS:
        url = f"https://paddledet.bj.bcebos.com/deploy/third_engine/picodet_{size}_{resolution}_lcnet_postprocessed.onnx"
        source = OUT / f"picodet-{size}-{resolution}-official.onnx"
        if not source.exists():
            urllib.request.urlretrieve(url, source)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        candidate = OUT / f"picodet-{size}-{resolution}-fp32.onnx"
        candidate.write_bytes(source.read_bytes())
        jobs.append({"key": f"picodet-{size}-{resolution}", "model": str(candidate.relative_to(ROOT)).replace("\\", "/"), "manifest": f"models/pp-detection/picodet-{size}-{resolution}/manifest.json", "bytes": candidate.stat().st_size, "sha256": digest, "inputSize": resolution, "sourceModel": str(source.relative_to(ROOT)).replace("\\", "/")})
    (Path(__file__).parent / "jobs.json").write_text(json.dumps(jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
