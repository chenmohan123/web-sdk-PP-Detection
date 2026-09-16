"""Tiny FP16 分阶段发布器；默认只做本地准备，远程写入必须显式选择阶段。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import itertools
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent
QUALITY = ROOT / "reports/evaluation/2026-09-16-tiny-precision"
STAGE = ROOT / ".tmp/tiny-precision/publication"
PRODUCT = ROOT / "models/ppyolo-tiny-320/0.1.1"
PREVIOUS_PRODUCT = ROOT / "models/ppyolo-tiny-320/0.1.0"
FP16_MODEL = ROOT / ".tmp/tiny-precision/ppyolo-tiny-320-fp16.onnx"
LIFECYCLE_SOURCE = ROOT / ".tmp/tiny-precision/lifecycle-candidates.json"
LIFECYCLE_SCRIPT_SOURCE = ROOT / ".tmp/tiny-precision/lifecycle-candidates.mjs"

SDK_SHA = "c2b6a9733416571c77c8dc48fa68028251e5d8cccb201047c8387bf9433e1189"
FP32_BYTES = 4_511_117
FP32_SHA = "1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653"
FP16_BYTES = 2_357_376
FP16_SHA = "331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc"
W8A32_SHA = "9317cbfaf2f36b22430f1cf12c3bd00289458c3878aa3a9d1b34131264b99b53"
ALLOWED_PRECISIONS = ("fp16",)
SOURCES = ("modelscope", "huggingface")
REPOSITORY = "chenmohan/web-sdk-pp-detection"
PREFIX = "ppyolo-tiny-320/0.1.1/"
FP32_FILENAME = "ppyolo-tiny-320-fp32.onnx"
FP16_FILENAME = "ppyolo-tiny-320-fp16.onnx"
PARAMETER_COUNT = 1_086_147
PREVIOUS_ROOT_IDENTITY = {
    "bytes": 4_351,
    "sha256": "5a82e7fa6d188d9b130a1c55a1af829bc6277f91a4ba2a01f82e0f87f6fbb324",
}


def require(value: object, message: str) -> None:
    if not value:
        raise ValueError(message)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(path: Path) -> dict:
    return {"bytes": path.stat().st_size, "sha256": digest(path)}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_quality() -> list[dict]:
    receipt = load(QUALITY / "quality-receipt.json")
    for name, expected_sha in receipt["files"].items():
        path = QUALITY / name
        require(path.is_file() and digest(path) == expected_sha, "质量收据文件摘要错误：" + name)

    summary = load(QUALITY / "summary.json")
    jobs = load(QUALITY / "jobs.json")
    require(summary["sdkSha256"] == SDK_SHA and summary["browserRunCount"] == 18, "质量证据运行身份错误")
    require(len(summary["candidates"]) == 2, "质量候选集合错误")

    expected_candidates = {
        "fp16": {"bytes": FP16_BYTES, "sha256": FP16_SHA},
        "w8a32": {"bytes": 1_573_135, "sha256": W8A32_SHA},
    }
    require({item["precision"] for item in summary["candidates"]} == set(expected_candidates), "质量候选精度错误")
    for candidate in summary["candidates"]:
        require(candidate["key"] == "ppyolo-tiny-320", "质量候选模型错误")
        require(
            {key: candidate[key] for key in ("bytes", "sha256")} == expected_candidates[candidate["precision"]],
            "质量候选权重身份错误：" + candidate["precision"],
        )

    expected_rows = {
        (precision, backend, round_number)
        for precision in ("fp32", "fp16", "w8a32")
        for backend in ("wasm", "webgpu")
        for round_number in (1, 2, 3)
    }
    actual_rows = {(row["precision"], row["backend"], row["round"]) for row in summary["rows"]}
    require(len(summary["rows"]) == 18 and actual_rows == expected_rows, "质量后端或轮次缺失、重复")

    eligible = []
    for precision in ALLOWED_PRECISIONS:
        candidate = next(item for item in summary["candidates"] if item["precision"] == precision)
        require(
            candidate["qualityGatePassed"] is True
            and candidate["releaseDecision"] == "eligible-for-release-review",
            "允许候选未通过质量门禁：" + precision,
        )
        rows = [row for row in summary["rows"] if row["precision"] == precision]
        require(len(rows) == 6 and all(row["qualityGatePassed"] is True for row in rows), "允许候选逐轮门禁未通过：" + precision)
        matches = [job for job in jobs if job["key"] == "ppyolo-tiny-320" and job["precision"] == precision]
        require(len(matches) == 1, "允许候选 job 缺失或重复：" + precision)
        job = matches[0]
        require(
            {key: job[key] for key in ("bytes", "sha256")} == expected_candidates[precision],
            "允许候选 job 权重身份错误：" + precision,
        )
        eligible.append({key: job[key] for key in ("key", "precision", "model", "bytes", "sha256")})
    return eligible


def validate_lifecycle(path: Path, protocol_sha: str, jobs_sha: str) -> dict:
    value = load(path)
    require(value["protocolSha256"] == protocol_sha, "生命周期协议摘要错误")
    require(value["jobsSha256"] == jobs_sha, "生命周期 jobs 摘要错误")
    require(value["sdkSha256"] == SDK_SHA, "生命周期 SDK 摘要错误")
    rows = value["rows"]
    combinations = {(row["backend"], row["executionMode"]) for row in rows}
    require(
        len(rows) == 4 and combinations == set(itertools.product(("wasm", "webgpu"), ("main", "worker"))),
        "生命周期后端或执行模式缺失、重复",
    )
    for row in rows:
        runtime = row["runtime"]
        model = row["model"]
        require(row["key"] == "ppyolo-tiny-320-fp16" and row["status"] == "passed", "生命周期候选或状态错误")
        require(
            runtime["requestedBackend"] == row["backend"]
            and runtime["backend"] == row["backend"]
            and runtime["mode"] == row["executionMode"]
            and runtime["precision"] == "fp16"
            and runtime["fallbacks"] == [],
            "生命周期发生静默回退或运行身份错误",
        )
        require(
            model["id"] == "ppyolo-tiny-320"
            and model["version"] == "0.1.1"
            and model["variantId"] == "fp16"
            and model["bytes"] == FP16_BYTES,
            "生命周期模型身份错误",
        )
        require(
            row["artifacts"]["model"] == {"bytes": FP16_BYTES, "sha256": FP16_SHA},
            "生命周期权重身份错误",
        )
        require(
            row["abortCode"] == "ABORTED"
            and row["disposedCode"] == "DISPOSED"
            and bool(row["detections"])
            and row["detections"] == row["recovered"],
            "生命周期取消、恢复或重复释放未通过",
        )
    return value


def files(phase: str) -> list[dict]:
    folder = STAGE / phase
    if not folder.exists():
        return []
    return sorted(
        [{"path": path.relative_to(folder).as_posix(), **identity(path)} for path in folder.rglob("*") if path.is_file()],
        key=lambda item: item["path"],
    )


def _model_cards() -> tuple[str, str]:
    zh = f"""# PP-YOLO Tiny 320（0.1.1）

本版本复用 0.1.0 的 FP32 固定双源权重，并新增通过质量门槛的 FP16。FP16 为 {FP16_BYTES:,} 字节，SHA-256 `{FP16_SHA}`，相对 FP32 缩小 47.743%；保留 `Exp.0`、`Exp.2`、`Exp.4` 为 FP32，输入输出契约不变。

固定 64 图、WASM/WebGPU 各三轮结果中，FP16 最差 AP 变化为 -0.174649 个百分点，最低一对一检测保留率为 99.5192%，通过 AP 下降不超过 0.5 点且保留率不低于 95% 的门槛。W8A32 最差 AP 变化为 -0.537364 点，未通过，保留 labs 且不在本清单或稳定下载目录中。

已验证桌面 WASM/WebGPU、main/Worker、预取消、恢复、重复释放和缓存清理。证据仅覆盖 Windows 11 / Chromium 153 / ORT Web 1.27.0 的固定子集，不是完整 COCO mAP，不声明手机、NPU 或普遍加速。SDK/npm 仍为 0.4.0。

上游 PaddleDetection、许可、FP32 转换归因沿用 0.1.0。质量证据见 `reports/evaluation/2026-09-16-tiny-precision/`，分发证据见 `reports/distribution/2026-09-16-tiny-precision/`。
"""
    en = f"""# PP-YOLO Tiny 320 (0.1.1)

This version reuses the immutable FP32 sources from 0.1.0 and adds the quality-gated FP16 variant. FP16 is {FP16_BYTES:,} bytes with SHA-256 `{FP16_SHA}`, 47.743% smaller than FP32. `Exp.0`, `Exp.2`, and `Exp.4` remain FP32; the input and output contract is unchanged.

Across three fixed 64-image runs on both WASM and WebGPU, the worst FP16 AP change was -0.174649 points and the minimum one-to-one detection retention was 99.5192%. W8A32 missed the AP gate at -0.537364 points, remains labs-only, and is absent from this manifest and the stable download directory.

Desktop WASM/WebGPU, main/Worker, pre-cancellation, recovery, repeated disposal, and cache clearing were verified. Evidence is limited to the fixed subset on Windows 11, Chromium 153, and ORT Web 1.27.0; it is not full COCO mAP and makes no mobile, NPU, or universal speed claim. SDK/npm remains 0.4.0.

PaddleDetection attribution, license, and the FP32 conversion record are inherited from 0.1.0. See `reports/evaluation/2026-09-16-tiny-precision/` and `reports/distribution/2026-09-16-tiny-precision/`.
"""
    return zh, en


def prepare() -> None:
    eligible = require_quality()
    require(len(eligible) == 1 and eligible[0]["precision"] == "fp16", "发布允许集合必须只有 FP16")
    require(identity(FP16_MODEL) == {"bytes": FP16_BYTES, "sha256": FP16_SHA}, "本地 FP16 权重大小或摘要错误")
    require(not any((REPORT / f"{phase}-uploads.json").exists() for phase in ("weights", "metadata")), "已有上传记录，禁止重新准备")
    quality_receipt = load(QUALITY / "quality-receipt.json")
    protocol_sha = quality_receipt["files"]["protocol.json"]
    jobs_sha = quality_receipt["files"]["jobs.json"]
    validate_lifecycle(LIFECYCLE_SOURCE, protocol_sha, jobs_sha)

    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / "lifecycle-candidates.json").write_bytes(LIFECYCLE_SOURCE.read_bytes())
    lifecycle_script = LIFECYCLE_SCRIPT_SOURCE.read_text(encoding="utf-8").replace(
        'resolve(process.cwd(), ".tmp/tiny-precision/lifecycle-candidates.json")',
        'resolve(process.cwd(), "reports/distribution/2026-09-16-tiny-precision/lifecycle-candidates.json")',
    )
    (REPORT / "lifecycle-candidates.mjs").write_text(lifecycle_script, encoding="utf-8", newline="\n")

    PRODUCT.mkdir(parents=True, exist_ok=True)
    (PRODUCT / "LICENSE").write_bytes((PREVIOUS_PRODUCT / "LICENSE").read_bytes())
    (PRODUCT / "fp16-conversion.json").write_bytes(
        (QUALITY / "conversions/ppyolo-tiny-320-fp16.conversion.json").read_bytes()
    )
    zh, en = _model_cards()
    (PRODUCT / "README.md").write_text(zh, encoding="utf-8", newline="\n")
    (PRODUCT / "README.en.md").write_text(en, encoding="utf-8", newline="\n")

    for source in SOURCES:
        previous = ROOT / f".tmp/tiny-precision/{source}-README.previous.md"
        require(identity(previous) == PREVIOUS_ROOT_IDENTITY, "根模型卡前值错误：" + source)
    previous_text = (ROOT / ".tmp/tiny-precision/modelscope-README.previous.md").read_text(encoding="utf-8")
    root_card = previous_text + """

## PP-YOLO Tiny FP16（2026-09-16）

Tiny 320 新增 0.1.1 稳定清单，复用 0.1.0 FP32 固定来源并新增达标 FP16，当前共14个规格、39个稳定变体。W8A32 未通过 AP 门槛，仅保留 labs，未上传稳定目录。SDK/npm仍为0.4.0；本轮仅新增固定桌面 WASM/WebGPU、main/Worker 与缓存证据，不扩展手机或 NPU 声明。
"""
    (REPORT / "hub-README.md").write_text(root_card, encoding="utf-8", newline="\n")

    weight_folder = STAGE / "weights" / PREFIX
    weight_folder.mkdir(parents=True, exist_ok=True)
    (weight_folder / FP16_FILENAME).write_bytes(FP16_MODEL.read_bytes())
    for name in ("README.md", "README.en.md", "LICENSE", "fp16-conversion.json"):
        (weight_folder / name).write_bytes((PRODUCT / name).read_bytes())
    require(all("w8a32" not in item["path"].lower() for item in files("weights")), "W8A32 禁止进入上传暂存")

    protocol = {
        "date": "2026-09-16",
        "repository": REPOSITORY,
        "prefix": PREFIX,
        "sources": list(SOURCES),
        "sdk": "0.4.0",
        "sdkSha256": SDK_SHA,
        "qualityReceipt": identity(QUALITY / "quality-receipt.json"),
        "allowedPrecisions": list(ALLOWED_PRECISIONS),
        "fp32Reuse": {"bytes": FP32_BYTES, "sha256": FP32_SHA, "version": "0.1.0"},
        "fp16": {"bytes": FP16_BYTES, "sha256": FP16_SHA},
        "w8a32": {"sha256": W8A32_SHA, "decision": "labs-only-not-uploaded"},
        "previousRoot": PREVIOUS_ROOT_IDENTITY,
    }
    dump(REPORT / "protocol.json", protocol)
    dump(
        REPORT / "prepare-receipt.json",
        {
            "protocolSha256": digest(REPORT / "protocol.json"),
            "publisherSha256": digest(Path(__file__)),
            "qualityReceipt": identity(QUALITY / "quality-receipt.json"),
            "lifecycle": identity(REPORT / "lifecycle-candidates.json"),
            "lifecycleScript": identity(REPORT / "lifecycle-candidates.mjs"),
            "weightsFiles": files("weights"),
            "hubReadme": identity(REPORT / "hub-README.md"),
        },
    )
    print("质量收据、生命周期和 FP16 本地准备通过；W8A32 已拒绝；未上传。")


def binding() -> dict:
    receipt = load(REPORT / "prepare-receipt.json")
    require(receipt["protocolSha256"] == digest(REPORT / "protocol.json"), "准备后协议发生变化")
    require(receipt["publisherSha256"] == digest(Path(__file__)), "准备后发布器发生变化，请重新准备")
    require(receipt["qualityReceipt"] == identity(QUALITY / "quality-receipt.json"), "准备后质量收据发生变化")
    require(receipt["lifecycle"] == identity(REPORT / "lifecycle-candidates.json"), "准备后生命周期证据发生变化")
    require(receipt["lifecycleScript"] == identity(REPORT / "lifecycle-candidates.mjs"), "准备后生命周期脚本发生变化")
    require(receipt["weightsFiles"] == files("weights"), "准备后权重暂存发生变化")
    require(receipt["hubReadme"] == identity(REPORT / "hub-README.md"), "准备后根模型卡发生变化")
    require(all("w8a32" not in item["path"].lower() for item in receipt["weightsFiles"]), "W8A32 禁止进入上传收据")
    return {"protocolSha256": receipt["protocolSha256"], "receiptSha256": digest(REPORT / "prepare-receipt.json")}


def expected_files(phase: str) -> list[dict]:
    if phase == "weights":
        return load(REPORT / "prepare-receipt.json")["weightsFiles"]
    values = [{"path": PREFIX + name, **identity(PRODUCT / name)} for name in (
        "manifest.json", "README.md", "README.en.md", "LICENSE", "fp16-conversion.json"
    )]
    values.append({"path": "README.md", **identity(REPORT / "hub-README.md")})
    return sorted(values, key=lambda item: item["path"])


def uploads(phase: str, complete: bool = True) -> list[dict]:
    bound = binding()
    path = REPORT / f"{phase}-uploads.json"
    rows = load(path) if path.exists() else []
    require(len(rows) <= 2 and len({row["source"] for row in rows}) == len(rows), "上传来源重复")
    require({row["source"] for row in rows} <= set(SOURCES), "上传来源未知")
    if complete:
        require(len(rows) == 2, "缺少双源真实上传")
    for row in rows:
        require(re.fullmatch(r"[a-f0-9]{40}", row["revision"]) is not None, "上传 revision 不是 40 位提交")
        require(row["phase"] == phase and row["repository"] == REPOSITORY, "上传阶段或仓库错误")
        require(row["files"] == expected_files(phase), "上传文件集合或身份变化")
        require(all(row[key] == value for key, value in bound.items()), "上传记录与准备收据不一致")
    return rows


def remote_url(source: str, repository: str, revision: str, path: str) -> str:
    origin = "https://www.modelscope.cn/models" if source == "modelscope" else "https://huggingface.co"
    return f"{origin}/{repository}/resolve/{revision}/{path}"


def validate_downloads(phase: str) -> None:
    state = uploads(phase)
    record = load(REPORT / f"{phase}-downloads.json")
    require(record["uploadsSha256"] == digest(REPORT / f"{phase}-uploads.json"), "回读后上传状态被修改")
    require(record["binding"] == binding(), "回读收据绑定错误")
    expected = {(row["source"], item["path"]): (row, item) for row in state for item in row["files"]}
    rows = record["results"]
    require(len(rows) == len(expected) and {(row["source"], row["path"]) for row in rows} == set(expected), "回读组合缺失或重复")
    for row in rows:
        upload, item = expected[row["source"], row["path"]]
        require(
            row["passed"] is True
            and row["revision"] == upload["revision"]
            and row["url"] == remote_url(upload["source"], REPOSITORY, upload["revision"], item["path"])
            and all(row[key] == item[key] for key in ("bytes", "sha256")),
            "回读记录身份错误",
        )


def final_manifest() -> dict:
    validate_downloads("weights")
    value = load(PREVIOUS_PRODUCT / "manifest.json")
    fp32 = value["variants"][0]
    require(fp32["id"] == "fp32" and fp32["bytes"] == FP32_BYTES and fp32["sha256"] == FP32_SHA, "复用 FP32 身份错误")
    require({source["kind"] for source in fp32["sources"]} == set(SOURCES), "复用 FP32 来源错误")
    fp16 = {
        "id": "fp16",
        "precision": "fp16",
        "quantization": "mixed-fp16-sensitive-ops-fp32",
        "opset": 14,
        "bytes": FP16_BYTES,
        "sha256": FP16_SHA,
        "parameterCount": PARAMETER_COUNT,
        "status": "stable",
        "backends": ["wasm", "webgpu"],
        "filename": FP16_FILENAME,
        "sources": [],
    }
    for row in uploads("weights"):
        fp16["sources"].append(
            {
                "kind": row["source"],
                "repository": REPOSITORY,
                "revision": row["revision"],
                "path": PREFIX + FP16_FILENAME,
                "downloadUrl": remote_url(row["source"], REPOSITORY, row["revision"], PREFIX + FP16_FILENAME),
                "bytes": FP16_BYTES,
                "sha256": FP16_SHA,
            }
        )
    value["model"]["version"] = "0.1.1"
    value["model"]["assets"] = [
        {"filename": FP32_FILENAME, "bytes": FP32_BYTES, "sha256": FP32_SHA},
        {"filename": FP16_FILENAME, "bytes": FP16_BYTES, "sha256": FP16_SHA},
    ]
    value["variants"] = [fp32, fp16]
    value["limitations"] = [
        "Windows 11 / Chromium 153 / ORT Web 1.27.0 已完成固定 64 图三轮质量验证及 main/Worker 生命周期验证；未新增手机或 NPU 证据。",
        "FP16 保留 Exp.0、Exp.2、Exp.4 为 FP32；文件缩小不代表普遍加速或运行内存同比下降。",
        "W8A32 最差 AP 变化超过 0.5 个百分点，保留 labs，不在本稳定清单或下载目录中。",
    ]
    return value


def manifests() -> None:
    dump(PRODUCT / "manifest.json", final_manifest())
    print("0.1.1 清单已复用 FP32 固定来源并绑定 FP16 双源真实上传。")


def _previous_transport():
    path = ROOT / "reports/distribution/2026-09-15-ppyolo-tiny/publish.py"
    spec = importlib.util.spec_from_file_location("tiny_fp32_transport", path)
    require(spec is not None and spec.loader is not None, "无法加载旧 Tiny 通用传输函数")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def remote_identity(address: str) -> dict:
    """复用旧发布器的流式完整 GET；显式地址避免调用旧 FP32 入口。"""
    return _previous_transport().remote_identity(address)


def remote_head(source: str, repository: str) -> str:
    if source == "huggingface":
        from huggingface_hub import HfApi

        return HfApi().model_info(repository, revision="main").sha
    require(source == "modelscope", "未知来源：" + source)
    return subprocess.check_output(
        [
            "git",
            "-c",
            "http.sslBackend=openssl",
            "ls-remote",
            f"https://www.modelscope.cn/{repository}.git",
            "refs/heads/master",
        ],
        text=True,
    ).split()[0]


def remote_paths(source: str, repository: str, revision: str) -> set[str]:
    if source == "huggingface":
        from huggingface_hub import HfApi

        return set(HfApi().list_repo_files(repository, repo_type="model", revision=revision))
    require(source == "modelscope", "未知来源：" + source)
    from modelscope.hub.api import HubApi

    return {item["Path"] for item in HubApi().get_model_files(repository, revision=revision, recursive=True)}


def upload_folder(source: str, repository: str, folder: Path, message: str, parent: str) -> str:
    if source == "huggingface":
        from huggingface_hub import HfApi

        return HfApi().upload_folder(
            repo_id=repository,
            repo_type="model",
            folder_path=str(folder),
            commit_message=message,
            parent_commit=parent,
            delete_patterns=None,
        ).oid
    require(source == "modelscope", "未知来源：" + source)
    from modelscope.hub.api import HubApi

    require(remote_head(source, repository) == parent, "ModelScope HEAD 并发改变，拒绝上传")
    HubApi().upload_folder(
        repo_id=repository,
        repo_type="model",
        folder_path=str(folder),
        commit_message=message,
        sync_remote_repo=False,
        max_workers=1,
        disable_tqdm=True,
        use_cache=False,
    )
    return remote_head(source, repository)


def validate_browser() -> None:
    require((REPORT / "browser.json").is_file(), "缺少远程浏览器 8 组合证据")
    require(load(PRODUCT / "manifest.json") == final_manifest(), "最终清单与已验收来源不符")
    browser = load(REPORT / "browser.json")
    require(
        browser["status"] == "passed"
        and browser["modelSha256"] == FP16_SHA
        and browser["modelBytes"] == FP16_BYTES
        and browser["manifestSha256"] == digest(PRODUCT / "manifest.json")
        and browser["sdkSha256"] == SDK_SHA
        and browser["workerSha256"] == digest(ROOT / "packages/sdk/dist/inference.worker.js"),
        "浏览器证据产物身份错误",
    )
    require(
        browser["protocolSha256"] == binding()["protocolSha256"]
        and browser["receiptSha256"] == binding()["receiptSha256"],
        "浏览器证据协议或准备收据错误",
    )
    rows = browser["rows"]
    require(
        len(rows) == 8
        and {(row["sourceKind"], row["backend"], row["executionMode"]) for row in rows}
        == set(itertools.product(SOURCES, ("wasm", "webgpu"), ("main", "worker"))),
        "浏览器 8 组合缺失或重复",
    )
    manifest = load(PRODUCT / "manifest.json")
    variant = next(item for item in manifest["variants"] if item["id"] == "fp16")
    sources = {source["kind"]: source for source in variant["sources"]}
    references = {}
    for row in rows:
        require(
            row["status"] == "passed"
            and row["abortCode"] == "ABORTED"
            and row["disposedCode"] == "DISPOSED",
            "浏览器取消或重复释放未通过",
        )
        require(row["detections"] and row["detections"] == row["recovered"] == row["cached"]["detections"], "浏览器恢复或缓存推理不同")
        expected_source = sources[row["sourceKind"]]
        for result in (row, row["cached"]):
            runtime = result["runtime"]
            model = result["model"]
            require(
                runtime["backend"] == runtime["requestedBackend"] == row["backend"]
                and runtime["mode"] == row["executionMode"]
                and runtime["precision"] == "fp16"
                and runtime["fallbacks"] == [],
                "浏览器后端、模式或精度发生回退",
            )
            require(
                model["id"] == "ppyolo-tiny-320"
                and model["version"] == "0.1.1"
                and model["variantId"] == "fp16"
                and model["bytes"] == FP16_BYTES
                and all(model["source"][key] == expected_source[key] for key in ("kind", "revision", "sha256")),
                "浏览器模型来源身份错误",
            )
        for key, expected_source_kind in (("firstLoad", "network"), ("cachedLoad", "cache"), ("reloaded", "network")):
            timing = row[key]
            require(
                timing["modelSource"] == expected_source_kind
                and isinstance(timing["integrityMs"], (int, float))
                and not isinstance(timing["integrityMs"], bool)
                and timing["integrityMs"] >= 0,
                "浏览器下载、缓存或完整性计时错误",
            )
        for key in ("firstCache", "reloadedCache"):
            require(row[key] == {"entries": 1, "bytes": FP16_BYTES}, "浏览器缓存条目错误")
        for key in ("afterCurrentClear", "afterAllClear"):
            require(row[key] == {"entries": 0, "bytes": 0}, "浏览器缓存未清理")
        reference = references.setdefault(row["backend"], row["detections"])
        require(reference == row["detections"], "不同来源或 main/Worker 推理结果不一致")


def publish(phase: str) -> None:
    require(phase in ("weights", "metadata"), "未知上传阶段")
    bound = binding()
    if phase == "metadata":
        validate_browser()
        for name in ("manifest.json", "README.md", "README.en.md", "LICENSE", "fp16-conversion.json"):
            target = STAGE / phase / PREFIX / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((PRODUCT / name).read_bytes())
        (STAGE / phase / "README.md").write_bytes((REPORT / "hub-README.md").read_bytes())
    require(files(phase) == expected_files(phase), "上传暂存文件缺失、多余或摘要错误")
    require(all("w8a32" not in item["path"].lower() for item in files(phase)), "W8A32 禁止进入远程上传")

    state = uploads(phase, complete=False)
    for source in SOURCES:
        if any(row["source"] == source for row in state):
            continue
        parent = remote_head(source, REPOSITORY)
        require(re.fullmatch(r"[a-f0-9]{40}", parent) is not None, "远程 HEAD 无效")
        paths = remote_paths(source, REPOSITORY, parent)
        existing = {path for path in paths if path.startswith(PREFIX)}
        if phase == "weights":
            require(not existing, "新版本目录已经存在，禁止覆盖")
        else:
            require(existing == {item["path"] for item in expected_files("weights")}, "版本目录发生并发改变或 manifest 已存在")
            for item in expected_files("weights"):
                address = remote_url(source, REPOSITORY, parent, item["path"])
                require(
                    remote_identity(address) == {key: item[key] for key in ("bytes", "sha256")},
                    "远程权重目录发生改变",
                )
            root_address = remote_url(source, REPOSITORY, parent, "README.md")
            require(remote_identity(root_address) == PREVIOUS_ROOT_IDENTITY, "根 README 前值改变，停止覆盖")
        revision = upload_folder(
            source,
            REPOSITORY,
            STAGE / phase,
            f"发布 PP-YOLO Tiny 320 FP16 0.1.1：{phase}",
            parent,
        )
        require(re.fullmatch(r"[a-f0-9]{40}", revision) is not None and revision != parent, "上传没有返回新真实提交")
        state.append(
            {
                "source": source,
                "repository": REPOSITORY,
                "phase": phase,
                "revision": revision,
                "parentRevision": parent,
                "files": expected_files(phase),
                **bound,
                "uploadedAt": now(),
            }
        )
        dump(REPORT / f"{phase}-uploads.json", state)
        print(source, phase, revision)


def verify(phase: str) -> None:
    state = uploads(phase)
    require(files(phase) == expected_files(phase), "回读前暂存文件集合变化")
    rows = []
    for upload in state:
        for item in upload["files"]:
            address = remote_url(upload["source"], REPOSITORY, upload["revision"], item["path"])
            actual = remote_identity(address)
            require(
                actual == {key: item[key] for key in ("bytes", "sha256")},
                "远程完整 GET 大小或摘要错误：" + address,
            )
            rows.append(
                {
                    **item,
                    "source": upload["source"],
                    "revision": upload["revision"],
                    "url": address,
                    "passed": True,
                    "verifiedAt": now(),
                }
            )
    dump(
        REPORT / f"{phase}-downloads.json",
        {"uploadsSha256": digest(REPORT / f"{phase}-uploads.json"), "binding": binding(), "results": rows},
    )
    validate_downloads(phase)
    print(phase + " 双源全部文件完整 GET 回读通过")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("prepare", "weights", "verify-weights", "manifests", "metadata", "verify-metadata", "validate"),
    )
    command = parser.parse_args().command
    if command in ("weights", "metadata"):
        publish(command)
    elif command.startswith("verify-"):
        verify(command[7:])
    elif command == "prepare":
        prepare()
    elif command == "manifests":
        manifests()
    else:
        binding()
        validate_downloads("weights")
        validate_browser()
        validate_downloads("metadata")
        print("发布协议、双源上传和完整 GET、最终清单及远程浏览器验证通过")


if __name__ == "__main__":
    main()
