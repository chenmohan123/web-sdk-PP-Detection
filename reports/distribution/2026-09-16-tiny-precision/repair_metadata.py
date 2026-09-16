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
    before = path.read_bytes()
    value = json.loads(before.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("转换记录必须是 JSON 对象")
    after = before.replace(b"\r\n", b"\n")
    if b"\r" in after or json.loads(after.decode("utf-8")) != value:
        raise ValueError("转换记录只允许 CRLF 转 LF")
    if after != before:
        path.write_bytes(after)
    return identity(path)


def publisher():
    path = REPORT / "publish.py"
    spec = importlib.util.spec_from_file_location("tiny_precision_publish_repair", path)
    if spec is None or spec.loader is None:
        raise ValueError("无法加载本轮发布器")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _require(value: object, message: str) -> None:
    if not value:
        raise ValueError(message)


def _conversion_path(p) -> str:
    return p.PREFIX + "fp16-conversion.json"


def _with_lf_conversion(p, files: list[dict]) -> list[dict]:
    conversion = _conversion_path(p)
    normalized_bytes = (p.PRODUCT / "fp16-conversion.json").read_bytes().replace(b"\r\n", b"\n")
    normalized = {"bytes": len(normalized_bytes), "sha256": sha(normalized_bytes)}
    return sorted(
        [({**item, **normalized} if item["path"] == conversion else item) for item in files],
        key=lambda item: item["path"],
    )


def _validate_first_uploads(p, rows: list[dict]) -> None:
    _require(len(rows) == 2, "首轮元数据上传必须包含双源")
    _require({row.get("source") for row in rows} == set(p.SOURCES), "首轮元数据来源错误")
    for row in rows:
        _require(row.get("phase") == "metadata" and row.get("repository") == p.REPOSITORY, "首轮元数据阶段错误")
        _require(row.get("revision") and row.get("files"), "首轮元数据身份缺失")
        _require(all(row.get(key) == value for key, value in p.binding().items()), "首轮元数据绑定错误")
        _require(all("w8a32" not in item["path"].lower() for item in row["files"]), "W8A32 禁止进入首轮档案")


def _first_rows(p) -> list[dict]:
    archive = p.REPORT / "metadata-first-uploads.json"
    source = archive if archive.exists() else p.REPORT / "metadata-uploads.json"
    _require(source.exists(), "缺少首轮元数据上传档案")
    rows = p.load(source)
    _validate_first_uploads(p, rows)
    return rows


def preflight(p) -> tuple[dict, list[dict], list[dict]]:
    """在任何归档、规范化或远程写入前完成全部只读门禁。"""
    bound = p.binding()
    p.validate_downloads("weights")
    p.validate_browser()
    first = _first_rows(p)
    first_files = first[0]["files"]
    _require(
        p.identity(p.PRODUCT / "manifest.json")
        == {
            key: next(item for item in first_files if item["path"] == p.PREFIX + "manifest.json")[key]
            for key in ("bytes", "sha256")
        },
        "最终 manifest 相对首轮元数据发生变化",
    )
    allowed = _with_lf_conversion(p, first_files)
    actual = p.files("metadata")
    _require(actual in (sorted(first_files, key=lambda item: item["path"]), allowed), "元数据暂存集合不是允许集合")
    _require(actual == p.expected_files("metadata"), "元数据暂存与产品目录不一致")
    _require(all("w8a32" not in item["path"].lower() for item in actual), "W8A32 禁止进入元数据暂存")
    return bound, first, allowed


def record_failure(p, first: list[dict] | None = None) -> None:
    first = first or _first_rows(p)
    archive_path = p.REPORT / "metadata-first-uploads.json"
    if archive_path.exists():
        _require(p.load(archive_path) == first, "首次元数据档案已存在但身份不一致")

    source = next(row for row in first if row["source"] == "modelscope")
    path = _conversion_path(p)
    expected = next(item for item in source["files"] if item["path"] == path)
    actual = p.remote_identity(p.remote_url("modelscope", p.REPOSITORY, source["revision"], path))
    _require(actual != {key: expected[key] for key in ("bytes", "sha256")}, "首轮回读并非真实失败")
    failure = {
        "source": "modelscope",
        "revision": source["revision"],
        "path": path,
        "expected": {key: expected[key] for key in ("bytes", "sha256")},
        "actual": actual,
        "cause": "ModelScope 覆盖既有 JSON 时将 CRLF 规范为 LF；解析后的 JSON 对象保持一致。",
    }
    failure_path = p.REPORT / "metadata-first-readback-failure.json"
    if failure_path.exists():
        _require(p.load(failure_path) == failure, "首次回读失败档案已存在但身份不一致")
    if not archive_path.exists():
        p.dump(archive_path, first)
    if not failure_path.exists():
        p.dump(failure_path, failure)


def _completed(p) -> bool:
    path = p.REPORT / "metadata-uploads.json"
    if not path.exists() or not hasattr(p, "uploads"):
        return False
    p.uploads("metadata")
    return True


def upload_repair(p, preflight_result: tuple[dict, list[dict], list[dict]] | None = None) -> None:
    if _completed(p):
        print("metadata-repair 已完成，重入无操作")
        return
    bound, first, allowed = preflight_result or preflight(p)
    _require(p.files("metadata") == allowed, "规范化后元数据暂存集合不符")
    previous = {row["source"]: row for row in first}
    progress_path = p.REPORT / "metadata-repair-progress.json"
    state = p.load(progress_path) if progress_path.exists() else []
    _require({row["source"] for row in state} <= set(p.SOURCES), "恢复进度来源错误")
    _require(all(row.get("files") == allowed for row in state), "恢复进度文件集合错误")
    done = {row["source"]: row for row in state}
    for source in p.SOURCES:
        if source in done:
            _require(p.remote_head(source, p.REPOSITORY) == done[source]["revision"], source + " 恢复进度远端 HEAD 不一致")
            continue
        parent = p.remote_head(source, p.REPOSITORY)
        _require(parent == previous[source]["revision"], source + " HEAD 已在首轮元数据提交后改变")
        root_url = p.remote_url(source, p.REPOSITORY, parent, "README.md")
        _require(p.remote_identity(root_url) == p.identity(p.REPORT / "hub-README.md"), source + " 根 README 在恢复前发生变化")
        model_url = p.remote_url(source, p.REPOSITORY, parent, p.PREFIX + p.FP16_FILENAME)
        _require(p.remote_identity(model_url) == {"bytes": p.FP16_BYTES, "sha256": p.FP16_SHA}, source + " FP16 权重在恢复前发生变化")
        revision = p.upload_folder(
            source,
            p.REPOSITORY,
            p.STAGE / "metadata",
            "修复 PP-YOLO Tiny FP16 转换记录换行并统一双源字节",
            parent,
        )
        _require(revision != parent, "恢复上传没有生成新提交")
        done[source] = {
            "source": source,
            "repository": p.REPOSITORY,
            "phase": "metadata",
            "revision": revision,
            "parentRevision": parent,
            "files": allowed,
            **bound,
            "uploadedAt": p.now(),
            "repair": "normalize-fp16-conversion-json-lf",
        }
        p.dump(progress_path, [done[name] for name in p.SOURCES if name in done])
        print(source, "metadata-repair", revision)
    _require(set(done) == set(p.SOURCES), "恢复进度未完成双源上传")
    p.dump(p.REPORT / "metadata-uploads.json", [done[name] for name in p.SOURCES])


def main() -> None:
    p = publisher()
    if _completed(p):
        print("metadata-repair 已完成，重入无操作")
        return
    preflight_result = preflight(p)
    record_failure(p, preflight_result[1])
    for path in (
        p.PRODUCT / "fp16-conversion.json",
        p.STAGE / "metadata" / p.PREFIX / "fp16-conversion.json",
    ):
        normalize_json_lf(path)
    preflight(p)
    upload_repair(p)


if __name__ == "__main__":
    main()
