from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

UPSTREAM_REVISION = "b25522a0f4bde8c80603f3ba5e3472059972e3b5"
OFFICIAL_SOURCES = {
    "weights": "https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_s_80e_coco.pdparams",
    "upstream": f"https://github.com/PaddlePaddle/PaddleDetection/archive/{UPSTREAM_REVISION}.zip",
    "annotations": "https://s3.amazonaws.com/images.cocodataset.org/annotations/annotations_trainval2017.zip",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, *, expected_bytes: int, expected_sha256: str) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(path)
    actual_bytes = path.stat().st_size
    if actual_bytes != expected_bytes:
        raise ValueError(f"{path.name} 字节数不匹配：预期 {expected_bytes}，实际 {actual_bytes}")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256.lower():
        raise ValueError(f"{path.name} SHA-256 不匹配")
    return {"path": str(path), "bytes": actual_bytes, "sha256": actual_sha256}


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 PP-YOLOE 固定来源文件")
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--downloads-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        lock = json.loads(args.lock.read_text(encoding="utf-8"))
        for item in lock["files"]:
            verify_file(args.downloads_dir / item["filename"], expected_bytes=item["bytes"], expected_sha256=item["sha256"])
    except Exception as exc:
        print(f"来源校验失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
