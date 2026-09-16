"""Tiny FP16 发布状态机测试；全部远程边界均使用隔离替身。"""
import copy
import importlib.util
import itertools
import json
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location("tiny_precision_publish", Path(__file__).with_name("publish.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


@pytest.fixture
def quality_sandbox(tmp_path, monkeypatch):
    quality = tmp_path / "quality"
    summary = {
        "protocolSha256": "a" * 64,
        "sdkSha256": p.SDK_SHA,
        "browserRunCount": 18,
        "qualityGatePassed": False,
        "candidates": [
            {
                "key": "ppyolo-tiny-320",
                "precision": "fp16",
                "bytes": p.FP16_BYTES,
                "sha256": p.FP16_SHA,
                "qualityGatePassed": True,
                "releaseDecision": "eligible-for-release-review",
            },
            {
                "key": "ppyolo-tiny-320",
                "precision": "w8a32",
                "bytes": 1_573_135,
                "sha256": p.W8A32_SHA,
                "qualityGatePassed": False,
                "releaseDecision": "labs-only",
            },
        ],
        "rows": [
            {
                "precision": precision,
                "backend": backend,
                "round": round_number,
                "qualityGatePassed": precision != "w8a32",
            }
            for round_number in (1, 2, 3)
            for precision in ("fp32", "fp16", "w8a32")
            for backend in ("wasm", "webgpu")
        ],
    }
    jobs = [
        {
            "key": "ppyolo-tiny-320",
            "precision": "fp16",
            "model": ".tmp/tiny-precision/ppyolo-tiny-320-fp16.onnx",
            "bytes": p.FP16_BYTES,
            "sha256": p.FP16_SHA,
        },
        {
            "key": "ppyolo-tiny-320",
            "precision": "w8a32",
            "model": ".tmp/tiny-precision/ppyolo-tiny-320-w8a32.onnx",
            "bytes": 1_573_135,
            "sha256": p.W8A32_SHA,
        },
    ]
    write_json(quality / "summary.json", summary)
    write_json(quality / "jobs.json", jobs)
    write_json(quality / "protocol.json", {"schemaVersion": 1})
    receipt = {
        "files": {
            "summary.json": p.digest(quality / "summary.json"),
            "jobs.json": p.digest(quality / "jobs.json"),
            "protocol.json": p.digest(quality / "protocol.json"),
        }
    }
    write_json(quality / "quality-receipt.json", receipt)
    monkeypatch.setattr(p, "QUALITY", quality)
    return summary


def test_quality_gate_reads_candidates_individually(quality_sandbox):
    assert p.require_quality() == [
        {
            "key": "ppyolo-tiny-320",
            "precision": "fp16",
            "model": ".tmp/tiny-precision/ppyolo-tiny-320-fp16.onnx",
            "bytes": p.FP16_BYTES,
            "sha256": p.FP16_SHA,
        }
    ]


@pytest.mark.parametrize("mutation", ["missing-round", "failed-row", "receipt", "candidate-identity"])
def test_quality_gate_rejects_incomplete_or_mutated_evidence(quality_sandbox, mutation):
    summary_path = p.QUALITY / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if mutation == "missing-round":
        summary["rows"] = [
            row
            for row in summary["rows"]
            if not (row["precision"] == "fp16" and row["backend"] == "webgpu" and row["round"] == 3)
        ]
        write_json(summary_path, summary)
        receipt = json.loads((p.QUALITY / "quality-receipt.json").read_text(encoding="utf-8"))
        receipt["files"]["summary.json"] = p.digest(summary_path)
        write_json(p.QUALITY / "quality-receipt.json", receipt)
    elif mutation == "failed-row":
        next(row for row in summary["rows"] if row["precision"] == "fp16")["qualityGatePassed"] = False
        write_json(summary_path, summary)
        receipt = json.loads((p.QUALITY / "quality-receipt.json").read_text(encoding="utf-8"))
        receipt["files"]["summary.json"] = p.digest(summary_path)
        write_json(p.QUALITY / "quality-receipt.json", receipt)
    elif mutation == "receipt":
        receipt = json.loads((p.QUALITY / "quality-receipt.json").read_text(encoding="utf-8"))
        receipt["files"]["summary.json"] = "0" * 64
        write_json(p.QUALITY / "quality-receipt.json", receipt)
    else:
        summary["candidates"][0]["bytes"] += 1
        write_json(summary_path, summary)
        receipt = json.loads((p.QUALITY / "quality-receipt.json").read_text(encoding="utf-8"))
        receipt["files"]["summary.json"] = p.digest(summary_path)
        write_json(p.QUALITY / "quality-receipt.json", receipt)
    with pytest.raises(ValueError):
        p.require_quality()


def test_w8a32_remains_forbidden_even_if_receipt_is_tampered_to_pass(quality_sandbox):
    summary_path = p.QUALITY / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    w8a32 = next(item for item in summary["candidates"] if item["precision"] == "w8a32")
    w8a32.update({"qualityGatePassed": True, "releaseDecision": "eligible-for-release-review"})
    for row in summary["rows"]:
        if row["precision"] == "w8a32":
            row["qualityGatePassed"] = True
    write_json(summary_path, summary)
    receipt = json.loads((p.QUALITY / "quality-receipt.json").read_text(encoding="utf-8"))
    receipt["files"]["summary.json"] = p.digest(summary_path)
    write_json(p.QUALITY / "quality-receipt.json", receipt)

    assert [item["precision"] for item in p.require_quality()] == ["fp16"]


def lifecycle_value():
    rows = []
    for backend in ("wasm", "webgpu"):
        for execution_mode in ("main", "worker"):
            runtime = {
                "requestedBackend": backend,
                "backend": backend,
                "mode": execution_mode,
                "precision": "fp16",
                "fallbacks": [],
            }
            model = {
                "id": "ppyolo-tiny-320",
                "version": "0.1.1",
                "variantId": "fp16",
                "bytes": p.FP16_BYTES,
            }
            detections = [{"classId": 0, "score": 0.9}]
            rows.append(
                {
                    "key": "ppyolo-tiny-320-fp16",
                    "backend": backend,
                    "executionMode": execution_mode,
                    "runtime": runtime,
                    "model": model,
                    "detections": detections,
                    "recovered": copy.deepcopy(detections),
                    "abortCode": "ABORTED",
                    "disposedCode": "DISPOSED",
                    "artifacts": {"model": {"bytes": p.FP16_BYTES, "sha256": p.FP16_SHA}},
                    "status": "passed",
                }
            )
    return {
        "protocolSha256": "a" * 64,
        "jobsSha256": "b" * 64,
        "sdkSha256": p.SDK_SHA,
        "rows": rows,
    }


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "fallback", "abort", "identity", "recovery"])
def test_lifecycle_requires_all_real_actions(tmp_path, mutation):
    value = lifecycle_value()
    if mutation == "missing":
        value["rows"].pop()
    elif mutation == "duplicate":
        value["rows"][-1] = copy.deepcopy(value["rows"][0])
    elif mutation == "fallback":
        value["rows"][0]["runtime"]["fallbacks"] = [{"from": "webgpu", "to": "wasm"}]
    elif mutation == "abort":
        value["rows"][0]["abortCode"] = None
    elif mutation == "identity":
        value["rows"][0]["artifacts"]["model"]["sha256"] = "0" * 64
    else:
        value["rows"][0]["recovered"] = []
    path = tmp_path / "lifecycle.json"
    write_json(path, value)
    with pytest.raises(ValueError):
        p.validate_lifecycle(path, "a" * 64, "b" * 64)


def test_lifecycle_accepts_fp16_four_combinations(tmp_path):
    path = tmp_path / "lifecycle.json"
    write_json(path, lifecycle_value())
    assert p.validate_lifecycle(path, "a" * 64, "b" * 64) == lifecycle_value()


@pytest.fixture
def publication_sandbox(tmp_path, monkeypatch):
    paths = {
        "ROOT": tmp_path,
        "REPORT": tmp_path / "report",
        "QUALITY": tmp_path / "quality",
        "STAGE": tmp_path / "stage",
        "PRODUCT": tmp_path / "models/ppyolo-tiny-320/0.1.1",
        "FP16_MODEL": tmp_path / ".tmp/tiny-precision/ppyolo-tiny-320-fp16.onnx",
        "PREVIOUS_PRODUCT": tmp_path / "models/ppyolo-tiny-320/0.1.0",
        "LIFECYCLE_SOURCE": tmp_path / ".tmp/tiny-precision/lifecycle-candidates.json",
        "LIFECYCLE_SCRIPT_SOURCE": tmp_path / ".tmp/tiny-precision/lifecycle-candidates.mjs",
    }
    for name, value in paths.items():
        monkeypatch.setattr(p, name, value)
    p.REPORT.mkdir(parents=True)
    p.QUALITY.mkdir(parents=True)
    p.PREVIOUS_PRODUCT.mkdir(parents=True)
    p.FP16_MODEL.parent.mkdir(parents=True)
    p.FP16_MODEL.write_bytes(b"f" * p.FP16_BYTES)
    monkeypatch.setattr(p, "identity", lambda path: {"bytes": path.stat().st_size, "sha256": p.FP16_SHA} if path == p.FP16_MODEL else {"bytes": path.stat().st_size, "sha256": p.digest(path)})
    old_manifest = {
        "schemaVersion": 1,
        "model": {"id": "ppyolo-tiny-320", "version": "0.1.0", "architecture": "PP-YOLO Tiny", "assets": []},
        "input": {"name": "image", "shape": [1, 3, 320, 320], "dtype": "float32"},
        "outputs": [{"name": "output", "shape": [-1, 6], "dtype": "float32"}],
        "preprocessing": {"size": {"width": 320, "height": 320}},
        "postprocessing": {"type": "nms"},
        "labels": ["person"],
        "variants": [
            {
                "id": "fp32",
                "precision": "fp32",
                "quantization": "none",
                "opset": 14,
                "bytes": p.FP32_BYTES,
                "sha256": p.FP32_SHA,
                "parameterCount": p.PARAMETER_COUNT,
                "status": "stable",
                "backends": ["wasm", "webgpu"],
                "filename": p.FP32_FILENAME,
                "sources": [
                    {
                        "kind": source,
                        "repository": p.REPOSITORY,
                        "revision": digit * 40,
                        "path": f"ppyolo-tiny-320/0.1.0/{p.FP32_FILENAME}",
                        "downloadUrl": f"https://example.invalid/{source}/{digit * 40}/{p.FP32_FILENAME}",
                        "bytes": p.FP32_BYTES,
                        "sha256": p.FP32_SHA,
                    }
                    for source, digit in (("modelscope", "1"), ("huggingface", "2"))
                ],
            }
        ],
        "status": "stable",
        "defaultVariant": "fp32",
        "defaultSource": "modelscope",
        "limitations": ["old"],
    }
    write_json(p.PREVIOUS_PRODUCT / "manifest.json", old_manifest)
    (p.PREVIOUS_PRODUCT / "LICENSE").write_text("license", encoding="utf-8")
    write_json(p.QUALITY / "conversions/ppyolo-tiny-320-fp16.conversion.json", {"precision": "fp16"})
    write_json(p.QUALITY / "jobs.json", [{"precision": "fp16"}])
    write_json(p.QUALITY / "protocol.json", {"schemaVersion": 1})
    write_json(
        p.QUALITY / "quality-receipt.json",
        {"files": {"protocol.json": "a" * 64, "jobs.json": "b" * 64}},
    )
    write_json(p.LIFECYCLE_SOURCE, lifecycle_value())
    p.LIFECYCLE_SCRIPT_SOURCE.write_text(
        'const outName = resolve(process.cwd(), ".tmp/tiny-precision/lifecycle-candidates.json");\n',
        encoding="utf-8",
    )
    for source in p.SOURCES:
        previous = tmp_path / f".tmp/tiny-precision/{source}-README.previous.md"
        previous.parent.mkdir(parents=True, exist_ok=True)
        previous.write_text("旧根模型卡\n", encoding="utf-8", newline="\n")
    monkeypatch.setattr(
        p,
        "PREVIOUS_ROOT_IDENTITY",
        p.identity(tmp_path / ".tmp/tiny-precision/modelscope-README.previous.md"),
    )
    monkeypatch.setattr(
        p,
        "require_quality",
        lambda: [
            {
                "key": "ppyolo-tiny-320",
                "precision": "fp16",
                "model": ".tmp/tiny-precision/ppyolo-tiny-320-fp16.onnx",
                "bytes": p.FP16_BYTES,
                "sha256": p.FP16_SHA,
            }
        ],
    )
    return old_manifest


def test_prepare_stages_only_fp16_and_archives_lifecycle(publication_sandbox):
    p.prepare()
    paths = {item["path"] for item in p.files("weights")}
    assert p.PREFIX + p.FP16_FILENAME in paths
    assert all("w8a32" not in path.lower() for path in paths)
    assert (p.REPORT / "lifecycle-candidates.json").is_file()
    script = (p.REPORT / "lifecycle-candidates.mjs").read_text(encoding="utf-8")
    assert "reports/distribution/2026-09-16-tiny-precision" in script
    assert (p.REPORT / "prepare-receipt.json").is_file()


def test_final_manifest_reuses_fp32_and_adds_only_fp16(publication_sandbox):
    p.prepare()
    uploads = [
        {
            "source": source,
            "revision": digit * 40,
            "files": p.files("weights"),
            "phase": "weights",
            "repository": p.REPOSITORY,
            **p.binding(),
        }
        for source, digit in (("modelscope", "3"), ("huggingface", "4"))
    ]
    p.dump(p.REPORT / "weights-uploads.json", uploads)
    p.dump(
        p.REPORT / "weights-downloads.json",
        {
            "uploadsSha256": p.digest(p.REPORT / "weights-uploads.json"),
            "binding": p.binding(),
            "results": [
                {
                    **item,
                    "source": upload["source"],
                    "revision": upload["revision"],
                    "url": p.remote_url(upload["source"], p.REPOSITORY, upload["revision"], item["path"]),
                    "passed": True,
                }
                for upload in uploads
                for item in upload["files"]
            ],
        },
    )
    manifest = p.final_manifest()
    assert manifest["model"]["version"] == "0.1.1"
    assert [variant["id"] for variant in manifest["variants"]] == ["fp32", "fp16"]
    assert manifest["variants"][0]["sources"] == publication_sandbox["variants"][0]["sources"]
    assert manifest["variants"][1]["precision"] == "fp16"
    assert {source["kind"] for source in manifest["variants"][1]["sources"]} == set(p.SOURCES)
    assert all("w8a32" not in json.dumps(value).lower() for value in [manifest["model"], manifest["variants"]])


@pytest.fixture
def remote_sandbox(publication_sandbox, monkeypatch):
    p.prepare()
    heads = {"modelscope": "1" * 40, "huggingface": "2" * 40}
    remote = {}
    calls = []

    def remote_head(source, repository):
        assert repository == p.REPOSITORY
        return heads[source]

    def remote_paths(source, repository, revision):
        assert repository == p.REPOSITORY and revision == heads[source]
        return {key[3] for key in remote if key[:3] == (source, repository, revision)}

    def upload_folder(source, repository, folder, message, parent):
        assert repository == p.REPOSITORY
        assert folder in (p.STAGE / "weights", p.STAGE / "metadata")
        assert parent == heads[source]
        calls.append({"source": source, "repository": repository, "folder": folder, "message": message, "parent": parent})
        revision = ("3" if source == "modelscope" else "4") * 40 if folder.name == "weights" else ("5" if source == "modelscope" else "6") * 40
        for item in p.files(folder.name):
            remote[(source, repository, revision, item["path"])] = {key: item[key] for key in ("bytes", "sha256")}
        heads[source] = revision
        return revision

    def remote_identity(address):
        for (source, repository, revision, path), value in remote.items():
            if address == p.remote_url(source, repository, revision, path):
                return value
        if address.endswith("/README.md"):
            return p.PREVIOUS_ROOT_IDENTITY
        raise AssertionError("未登记远程地址：" + address)

    monkeypatch.setattr(p, "remote_head", remote_head)
    monkeypatch.setattr(p, "remote_paths", remote_paths)
    monkeypatch.setattr(p, "upload_folder", upload_folder)
    monkeypatch.setattr(p, "remote_identity", remote_identity)
    return {"heads": heads, "remote": remote, "calls": calls}


def test_weight_upload_uses_explicit_parameters_and_complete_get(remote_sandbox):
    p.publish("weights")
    assert len(remote_sandbox["calls"]) == 2
    assert {call["source"] for call in remote_sandbox["calls"]} == set(p.SOURCES)
    assert all(call["repository"] == p.REPOSITORY and call["folder"] == p.STAGE / "weights" for call in remote_sandbox["calls"])
    p.verify("weights")
    downloads = p.load(p.REPORT / "weights-downloads.json")
    assert len(downloads["results"]) == len(p.files("weights")) * 2
    assert all(row["passed"] is True for row in downloads["results"])


def test_existing_version_is_rejected_before_remote_write(publication_sandbox, monkeypatch):
    p.prepare()
    monkeypatch.setattr(p, "remote_head", lambda source, repository: "1" * 40)
    monkeypatch.setattr(p, "remote_paths", lambda source, repository, revision: {p.PREFIX + "existing"})
    monkeypatch.setattr(p, "upload_folder", lambda *args: pytest.fail("已有目录时不可远程写入"))
    with pytest.raises(ValueError, match="禁止覆盖"):
        p.publish("weights")


def test_wrong_full_get_never_writes_pass_receipt(remote_sandbox, monkeypatch):
    p.publish("weights")
    monkeypatch.setattr(p, "remote_identity", lambda address: {"bytes": 1, "sha256": "0" * 64})
    with pytest.raises(ValueError, match="完整 GET"):
        p.verify("weights")
    assert not (p.REPORT / "weights-downloads.json").exists()


def test_metadata_upload_checks_root_readme_previous_value(remote_sandbox, monkeypatch):
    p.publish("weights")
    p.verify("weights")
    p.manifests()
    monkeypatch.setattr(p, "validate_browser", lambda: None)
    original = p.remote_identity

    def changed_root(address):
        if address.endswith("/README.md") and p.PREFIX not in address:
            return {"bytes": 1, "sha256": "0" * 64}
        return original(address)

    monkeypatch.setattr(p, "remote_identity", changed_root)
    with pytest.raises(ValueError, match="前值改变"):
        p.publish("metadata")
    assert len(remote_sandbox["calls"]) == 2


def test_metadata_upload_and_complete_get(remote_sandbox, monkeypatch):
    p.publish("weights")
    p.verify("weights")
    p.manifests()
    monkeypatch.setattr(p, "validate_browser", lambda: None)
    p.publish("metadata")
    p.verify("metadata")
    assert len(p.load(p.REPORT / "metadata-downloads.json")["results"]) == len(p.expected_files("metadata")) * 2
    assert all("w8a32" not in item["path"].lower() for item in p.expected_files("metadata"))


@pytest.mark.parametrize("mutation", ["valid", "missing", "fallback", "source", "cache", "dispose"])
def test_browser_receipt_checks_all_eight_combinations(publication_sandbox, monkeypatch, mutation):
    p.prepare()
    worker = p.ROOT / "packages/sdk/dist/inference.worker.js"
    worker.parent.mkdir(parents=True)
    worker.write_bytes(b"worker")
    manifest = publication_sandbox
    manifest["model"]["version"] = "0.1.1"
    fp16_sources = [
        {
            "kind": source,
            "repository": p.REPOSITORY,
            "revision": digit * 40,
            "path": p.PREFIX + p.FP16_FILENAME,
            "downloadUrl": p.remote_url(source, p.REPOSITORY, digit * 40, p.PREFIX + p.FP16_FILENAME),
            "bytes": p.FP16_BYTES,
            "sha256": p.FP16_SHA,
        }
        for source, digit in (("modelscope", "3"), ("huggingface", "4"))
    ]
    manifest["variants"].append(
        {
            "id": "fp16",
            "precision": "fp16",
            "bytes": p.FP16_BYTES,
            "sha256": p.FP16_SHA,
            "sources": fp16_sources,
        }
    )
    write_json(p.PRODUCT / "manifest.json", manifest)
    monkeypatch.setattr(p, "final_manifest", lambda: manifest)
    rows = []
    for source, backend, mode in itertools.product(p.SOURCES, ("wasm", "webgpu"), ("main", "worker")):
        runtime = {"backend": backend, "requestedBackend": backend, "mode": mode, "precision": "fp16", "fallbacks": []}
        model = {
            "id": "ppyolo-tiny-320",
            "version": "0.1.1",
            "variantId": "fp16",
            "bytes": p.FP16_BYTES,
            "source": {"kind": source, "revision": next(item["revision"] for item in fp16_sources if item["kind"] == source), "sha256": p.FP16_SHA},
        }
        rows.append(
            {
                "sourceKind": source,
                "backend": backend,
                "executionMode": mode,
                "status": "passed",
                "runtime": runtime,
                "model": model,
                "detections": [{"label": "person"}],
                "recovered": [{"label": "person"}],
                "cached": {"runtime": copy.deepcopy(runtime), "model": copy.deepcopy(model), "detections": [{"label": "person"}]},
                "abortCode": "ABORTED",
                "disposedCode": "DISPOSED",
                "firstLoad": {"modelSource": "network", "integrityMs": 1},
                "cachedLoad": {"modelSource": "cache", "integrityMs": 1},
                "reloaded": {"modelSource": "network", "integrityMs": 1},
                "firstCache": {"entries": 1, "bytes": p.FP16_BYTES},
                "reloadedCache": {"entries": 1, "bytes": p.FP16_BYTES},
                "afterCurrentClear": {"entries": 0, "bytes": 0},
                "afterAllClear": {"entries": 0, "bytes": 0},
            }
        )
    browser = {
        "status": "passed",
        "modelSha256": p.FP16_SHA,
        "modelBytes": p.FP16_BYTES,
        "manifestSha256": p.digest(p.PRODUCT / "manifest.json"),
        "sdkSha256": p.SDK_SHA,
        "workerSha256": p.digest(worker),
        **p.binding(),
        "rows": rows,
    }
    if mutation == "missing":
        rows.pop()
    elif mutation == "fallback":
        rows[0]["runtime"]["fallbacks"] = [{"to": "wasm"}]
    elif mutation == "source":
        rows[0]["model"]["source"]["revision"] = "0" * 40
    elif mutation == "cache":
        rows[0]["cachedLoad"]["modelSource"] = "network"
    elif mutation == "dispose":
        rows[0]["disposedCode"] = None
    p.dump(p.REPORT / "browser.json", browser)
    if mutation == "valid":
        p.validate_browser()
    else:
        with pytest.raises(ValueError):
            p.validate_browser()
