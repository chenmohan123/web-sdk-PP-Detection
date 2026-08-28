from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

def check_environment() -> dict[str, object]:
    return {"python": sys.version, "modules": {name: importlib.util.find_spec(name) is not None for name in ("paddle", "paddle2onnx", "onnx")}, "gitLfs": shutil.which("git-lfs") is not None}

def fetch(*, revision: str, weights_url: str, config_url: str, output_dir: Path, timeout: int = 30) -> dict[str, object]:
    if not isinstance(revision, str) or re.fullmatch(r"[0-9a-fA-F]{40,64}", revision) is None:
        raise ValueError("--revision 必须是 40 至 64 位十六进制不可变 revision")
    for label, url in (("weights", weights_url), ("config", config_url)):
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError(f"{label} URL 必须是带主机的 HTTP(S) 地址")
    output_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []
    for name, url in (("weights", weights_url), ("config", config_url)):
        destination = output_dir / ("model.pdparams" if name == "weights" else "inference.yml")
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=timeout) as response, destination.open("wb") as stream:
            stream.write(response.read())
        downloaded.append({"name": name, "url": url, "path": str(destination), "bytes": destination.stat().st_size})
    return {"revision": revision, "downloaded": downloaded, "environment": check_environment(), "timestamp": datetime.now(timezone.utc).isoformat()}

def main() -> int:
    parser = argparse.ArgumentParser(description="下载固定 revision 的官方 PicoDet-L-320 文件")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--weights-url", required=True)
    parser.add_argument("--config-url", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = fetch(revision=args.revision, weights_url=args.weights_url, config_url=args.config_url, output_dir=args.output_dir.resolve())
    except Exception as exc:
        print(f"下载失败: {exc}", file=sys.stderr)
        return 1
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
