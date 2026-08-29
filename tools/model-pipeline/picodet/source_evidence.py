"""校验 PicoDet 模型的不可变外部分发来源。"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

SOURCE_ORDER = ("huggingface", "modelscope", "git-lfs")
SOURCE_KINDS = set(SOURCE_ORDER)
REVISION_RE = re.compile(r"^[0-9a-fA-F]{40,64}$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def validate_source(source: dict[str, Any], artifact_bytes: int, artifact_sha256: str) -> dict[str, Any]:
    """校验单个来源，不联网且不读取环境变量。"""
    kind = source.get("kind")
    if kind not in SOURCE_KINDS:
        raise ValueError("来源 kind 必须是 huggingface、modelscope 或 git-lfs")
    for field in ("repository", "path"):
        if not isinstance(source.get(field), str) or not source[field].strip():
            raise ValueError(f"来源 {field} 不能为空")
    revision = source.get("revision")
    if not isinstance(revision, str) or not REVISION_RE.fullmatch(revision):
        raise ValueError("来源 revision 必须是 40 至 64 位十六进制值")
    url = source.get("downloadUrl")
    parsed = urlparse(url if isinstance(url, str) else "")
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("来源 downloadUrl 必须是带主机的 HTTPS 地址")
    if re.search(r"(?:^|/)main(?:/|$)", parsed.path, re.IGNORECASE):
        raise ValueError("来源 URL 必须使用不可变 revision，不能使用 main")
    declared_bytes = source.get("bytes")
    if not isinstance(declared_bytes, int) or isinstance(declared_bytes, bool) or declared_bytes < 1:
        raise ValueError("来源 bytes 必须是正整数")
    if declared_bytes != artifact_bytes:
        raise ValueError("来源 bytes 必须与本地模型文件一致")
    declared_sha = source.get("sha256")
    if not isinstance(declared_sha, str) or not SHA256_RE.fullmatch(declared_sha):
        raise ValueError("来源 sha256 必须是 64 位十六进制值")
    if declared_sha.lower() != artifact_sha256.lower():
        raise ValueError("来源 SHA-256 必须与本地模型文件一致")
    return source


def order_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按 Hugging Face、ModelScope、Git LFS 固定顺序返回来源。"""
    by_kind = {source.get("kind"): source for source in sources}
    missing = SOURCE_KINDS - set(by_kind)
    if missing:
        missing_text = ", ".join(sorted(missing))
        raise ValueError(f"来源必须包含三类来源（缺少 {missing_text}）；缺少 huggingface 或 modelscope 时不得生成清单")
    if len(by_kind) != len(sources):
        raise ValueError("来源 kind 不得重复")
    return [by_kind[kind] for kind in SOURCE_ORDER]
