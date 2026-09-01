from __future__ import annotations

import pytest

from picodet.source_evidence import order_sources, validate_source


ARTIFACT_BYTES = 23243834
ARTIFACT_SHA256 = "0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1"


def source(kind: str, revision: str = "a" * 40) -> dict[str, object]:
    return {
        "kind": kind,
        "repository": "chenmohan/web-sdk-pp-detection",
        "revision": revision,
        "path": "picodet-l-320-fp32.onnx",
        "downloadUrl": f"https://{kind}.example/model.onnx",
        "bytes": ARTIFACT_BYTES,
        "sha256": ARTIFACT_SHA256,
    }


@pytest.mark.parametrize("url", ["https://huggingface.co/org/model/resolve/main/model.onnx", "https://example.com/main/model.onnx"])
def test_rejects_moving_main_url(url: str) -> None:
    item = source("huggingface")
    item["downloadUrl"] = url
    with pytest.raises(ValueError, match="不可变|revision"):
        validate_source(item, ARTIFACT_BYTES, ARTIFACT_SHA256)


def test_rejects_non_hex_revision() -> None:
    with pytest.raises(ValueError, match="revision"):
        validate_source(source("huggingface", "main"), ARTIFACT_BYTES, ARTIFACT_SHA256)


def test_rejects_mismatched_bytes_and_sha256() -> None:
    item = source("huggingface")
    item["bytes"] = ARTIFACT_BYTES + 1
    with pytest.raises(ValueError, match="bytes"):
        validate_source(item, ARTIFACT_BYTES, ARTIFACT_SHA256)
    item = source("huggingface")
    item["sha256"] = "b" * 64
    with pytest.raises(ValueError, match="SHA"):
        validate_source(item, ARTIFACT_BYTES, ARTIFACT_SHA256)


def test_requires_huggingface_and_modelscope() -> None:
    with pytest.raises(ValueError, match="huggingface"):
        order_sources([source("git-lfs"), source("modelscope")])


def test_accepts_verified_revisions_and_orders_sources() -> None:
    items = [
        source("git-lfs", "50ec35925ca89945dcfc4d13935e65bf054ac741"),
        source("modelscope", "f853dee67f8362853c7043d490fe892912561f8b"),
        source("huggingface", "a9097cd2d855e32dd9bee19afba319906366416a"),
    ]
    ordered = order_sources(items)
    assert [item["kind"] for item in ordered] == ["huggingface", "modelscope", "git-lfs"]
    for item in ordered:
        validate_source(item, ARTIFACT_BYTES, ARTIFACT_SHA256)
