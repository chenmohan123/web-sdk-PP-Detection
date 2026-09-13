"""校验已锁定的官方来源，并导出普通 PP-YOLOE+ L 对照模型。"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import runpy
import sys
import zipfile

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
COMMIT = "b25522a0f4bde8c80603f3ba5e3472059972e3b5"
WEIGHT_SHA = "4348bb04b0c23b6b815dbc1e05eca22ad62fdf9c42192a600d37497ca4023c88"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--work", type=Path, default=ROOT / "work/sod-comparison")
    args = parser.parse_args()
    cache, work = args.cache_root.resolve(), args.work.resolve()
    lock = json.loads((REPORT.parent / "2026-09-13-2d-model-compatibility/sources.lock.json").read_text(encoding="utf-8"))
    archive = cache / ".tmp/phase2/downloads/paddledetection.zip"
    if hashlib.sha256(archive.read_bytes()).hexdigest() != lock["archive"]["sha256"]:
        raise ValueError("上游源码归档摘要不符")
    upstream = cache / f".tmp/phase2/upstream/PaddleDetection-{COMMIT}"
    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            if not item.is_dir() and (upstream.parent / item.filename).read_bytes() != source.read(item):
                raise ValueError(f"解压源码与归档不一致：{item.filename}")
    weight = work / "ppyoloe_plus_crn_l_80e_coco.pdparams"
    if weight.stat().st_size != 216672732 or hashlib.sha256(weight.read_bytes()).hexdigest() != WEIGHT_SHA:
        raise ValueError("普通 L 权重字节数或摘要不符")
    files = []
    for path in ["configs/ppyoloe/ppyoloe_plus_crn_l_80e_coco.yml", "configs/ppyoloe/README.md", "configs/ppyoloe/_base_/ppyoloe_plus_crn.yml"]:
        raw = (upstream / path).read_bytes()
        target = REPORT / "upstream" / (path + ".gz")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(raw, mtime=0))
        files.append({"path": path, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "snapshot": target.relative_to(REPORT).as_posix()})
    receipt = {"commit": COMMIT, "archiveSha256": lock["archive"]["sha256"], "files": files, "weight": {"url": "https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_l_80e_coco.pdparams", "bytes": weight.stat().st_size, "sha256": WEIGHT_SHA}}
    (REPORT / "reference-source.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.environ["MPLCONFIGDIR"] = str(work / "matplotlib")
    import paddle.jit.dy2static.utils as translator_utils

    def local_temp_dir():
        destination = work / "paddle-cache" / str(os.getpid())
        destination.mkdir(parents=True, exist_ok=True)
        return str(destination)

    translator_utils.get_temp_dir = local_temp_dir
    os.chdir(upstream)
    sys.path.insert(0, str(upstream))
    sys.argv = [str(upstream / "tools/export_model.py"), "-c", "configs/ppyoloe/ppyoloe_plus_crn_l_80e_coco.yml", "-o", "use_gpu=False", f"weights={weight}", "TestReader.inputs_def.image_shape=[3,640,640]", "export_onnx=True", "--output_dir", str(work / "exported")]
    print(sys.argv, flush=True)
    runpy.run_path(sys.argv[0], run_name="__main__")


if __name__ == "__main__":
    main()
