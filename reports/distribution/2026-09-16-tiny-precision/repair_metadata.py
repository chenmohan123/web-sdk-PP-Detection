"""恢复 ModelScope JSON 换行规范化造成的元数据字节不一致。"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def identity(path: Path) -> dict:
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": sha(data)}


def normalize_json_lf(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("转换记录必须是 JSON 对象")
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return identity(path)


def publisher():
    path = REPORT / "publish.py"
    spec = importlib.util.spec_from_file_location("tiny_precision_publish_repair", path)
    if spec is None or spec.loader is None:
        raise ValueError("无法加载本轮发布器")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def record_failure(p) -> None:
    uploads = p.load(p.REPORT / "metadata-uploads.json")
    p.dump(p.REPORT / "metadata-first-uploads.json", uploads)
    source = next(row for row in uploads if row["source"] == "modelscope")
    path = p.PREFIX + "fp16-conversion.json"
    actual = p.remote_identity(p.remote_url("modelscope", p.REPOSITORY, source["revision"], path))
    expected = next(item for item in source["files"] if item["path"] == path)
    p.dump(
        p.REPORT / "metadata-first-readback-failure.json",
        {
            "source": "modelscope",
            "revision": source["revision"],
            "path": path,
            "expected": {key: expected[key] for key in ("bytes", "sha256")},
            "actual": actual,
            "cause": "ModelScope 覆盖既有 JSON 时将 CRLF 规范为 LF；解析后的 JSON 对象保持一致。",
        },
    )


def upload_repair(p) -> None:
    previous = {row["source"]: row for row in p.load(p.REPORT / "metadata-first-uploads.json")}
    state = []
    for source in p.SOURCES:
        parent = p.remote_head(source, p.REPOSITORY)
        if parent != previous[source]["revision"]:
            raise ValueError(source + " HEAD 已在首轮元数据提交后改变")
        root_url = p.remote_url(source, p.REPOSITORY, parent, "README.md")
        if p.remote_identity(root_url) != p.identity(p.REPORT / "hub-README.md"):
            raise ValueError(source + " 根 README 在恢复前发生变化")
        model_url = p.remote_url(source, p.REPOSITORY, parent, p.PREFIX + p.FP16_FILENAME)
        if p.remote_identity(model_url) != {"bytes": p.FP16_BYTES, "sha256": p.FP16_SHA}:
            raise ValueError(source + " FP16 权重在恢复前发生变化")
        revision = p.upload_folder(
            source,
            p.REPOSITORY,
            p.STAGE / "metadata",
            "修复 PP-YOLO Tiny FP16 转换记录换行并统一双源字节",
            parent,
        )
        if revision == parent:
            raise ValueError("恢复上传没有生成新提交")
        state.append(
            {
                "source": source,
                "repository": p.REPOSITORY,
                "phase": "metadata",
                "revision": revision,
                "parentRevision": parent,
                "files": p.expected_files("metadata"),
                **p.binding(),
                "uploadedAt": p.now(),
                "repair": "normalize-fp16-conversion-json-lf",
            }
        )
        print(source, "metadata-repair", revision)
    p.dump(p.REPORT / "metadata-uploads.json", state)


def main() -> None:
    p = publisher()
    record_failure(p)
    for path in (
        p.PRODUCT / "fp16-conversion.json",
        p.STAGE / "metadata" / p.PREFIX / "fp16-conversion.json",
    ):
        normalize_json_lf(path)
    upload_repair(p)


if __name__ == "__main__":
    main()
