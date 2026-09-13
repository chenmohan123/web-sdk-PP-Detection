"""重算 SOD 四种执行组合的一致性，校验生命周期证据并生成汇总。"""
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys

report = Path(__file__).resolve().parents[1]
root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / "tools/model-pipeline"))
from evaluation import compare_detections


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def load_archive(name):
    return json.loads(gzip.decompress((report / "evidence" / name).read_bytes()))


def comparison(reference, candidate, image_ids):
    rows = []
    for image_id in image_ids:
        row = compare_detections(
            [p for p in reference if p["image_id"] == image_id],
            [p for p in candidate if p["image_id"] == image_id],
            iou_threshold=0.99, score_threshold=0.5,
        )
        require(row["unmatchedReferenceCount"] == row["unmatchedCandidateCount"] == 0, f"图片 {image_id} 检测不匹配")
        rows.append(row)
    return {
        "images": len(rows),
        "matched": sum(r["matchedCount"] for r in rows),
        "emptyImages": sum(r["referenceCount"] == r["candidateCount"] == 0 for r in rows),
        "unmatchedReference": 0, "unmatchedCandidate": 0,
        "maxScoreDelta": max((r["maxScoreDelta"] for r in rows if r["maxScoreDelta"] is not None), default=0),
        "maxBboxDeltaPixels": max((r["maxBboxDeltaPixels"] for r in rows if r["maxBboxDeltaPixels"] is not None), default=0),
    }


def summarize(raw):
    require(raw["status"] == "passed", "生命周期实测未通过")
    require(raw["model"] == {"bytes": 345644377, "sha256": "a8fb0978485d42f78346339490302e4f3116daa2cdc7c192b2e2250b1675cd2e"}, "候选模型不符")
    require(raw["runner"] == digest((report / "reproduction/verify_lifecycle.mjs").read_bytes()), "实测脚本与归档版本不同")
    reference = load_archive("pillow-predictions.json.gz")
    old = load_archive("browser-wasm.json.gz")
    require(raw["sdk"]["bytes"] == old["artifacts"]["sdk"]["bytes"], "SDK 构建大小异常")
    image_ids = [i["imageId"] for i in raw["images"]]
    require(image_ids == [i["imageId"] for i in old["images"]], "输入图片集合或顺序不符")
    for image in raw["images"]:
        require(image["sha256"] == next(i["sha256"] for i in old["images"] if i["imageId"] == image["imageId"]), "输入图片摘要不符")
    by_mode = {(r["backend"], r["mode"]): r for r in raw["results"]}
    require(len(raw["results"]) == 4 and set(by_mode) == {(b, m) for b in ("wasm", "webgpu") for m in ("main", "worker")}, "执行矩阵不完整")
    summaries = []
    for (backend, mode), result in by_mode.items():
        runtime = result["runtime"]
        require(result["status"] == "passed" and not result["pageErrors"], "浏览器执行错误")
        require(runtime["backend"] == runtime["requestedBackend"] == backend and runtime["mode"] == mode and runtime["precision"] == "fp32" and not runtime["fallbacks"], "实际执行信息不符")
        require(runtime["runtimeVersion"] == "1.27.0" and result["sdkVersion"] == "0.4.0", "运行时版本不符")
        require([i["imageId"] for i in result["images"]] == image_ids, "执行图片不完整")
        for prediction in result["predictions"]:
            require(prediction["image_id"] in image_ids, "输出包含未知图片")
        for image in result["images"]:
            require(image["count"] == sum(p["image_id"] == image["imageId"] for p in result["predictions"]), "检测数量与原始输出不符")
        lifecycle = result["lifecycle"]
        for name in ("preAborted", "boundaryAbort", "inflightAbort"):
            require(lifecycle[name]["code"] == "ABORTED", f"{name} 错误码不符")
        for name in ("preAborted", "boundaryAbort"):
            require(lifecycle[name]["dispatchedRuns"] == 0, "提前取消仍发出了推理")
        for name in ("disposeActive", "disposeQueued", "detectAfterDispose", "loadAfterDispose"):
            require(lifecycle[name]["code"] == "DISPOSED", f"{name} 错误码不符")
        require(lifecycle["reuseAfterAbort"]["parity"] and lifecycle["repeatedDispose"] == "passed", "取消复用或重复释放失败")
        metrics = result["metrics"]
        require(metrics["runs"] == 13, "真实推理调用次数不符")
        require(metrics["releases"] == (1 if mode == "main" else 0), "主线程释放次数不符")
        require(metrics["workersCreated"] == metrics["workersTerminated"] == (1 if mode == "worker" else 0), "Worker 未完整终止")
        python_parity = comparison(reference, result["predictions"], image_ids)
        require(python_parity["matched"] == 49, "Python 参考框数量不符")
        main_parity = comparison(by_mode[(backend, "main")]["predictions"], result["predictions"], image_ids)
        require(main_parity["maxScoreDelta"] == main_parity["maxBboxDeltaPixels"] == 0, "主线程与 Worker 未逐值一致")
        summaries.append({
            "backend": backend, "mode": mode, "runtime": runtime,
            "pythonParity": python_parity, "mainParity": main_parity,
            "loadTimings": result["loadTimings"],
            "coldImageMs": result["images"][0]["wallClockMs"],
            "warmImageCount": 7,
            "warmMedianMs": statistics.median(i["wallClockMs"] for i in result["images"][1:]),
            "lifecycle": lifecycle, "metrics": metrics,
        })
    require({f["mode"] for f in raw["failures"]} == {"main", "worker"} and len(raw["failures"]) == 2, "失败路径矩阵不完整")
    for failure in raw["failures"]:
        require(len(failure["results"]) == 5, "失败用例数量不符")
        for result in failure["results"]:
            require(result["code"] == result["expected"] and not any(e["phase"] == "fallback" for e in result["events"]), "失败路径发生回退")
        require(sorted(failure["requests"]) == sorted(f"/failure/{failure['mode']}/{source}" for source in ("modelscope", "huggingface")), "失败路径发生额外来源访问")
    return {
        "candidate": "ppyoloe-sod-l-640-coco", "status": "selected",
        "startedAt": raw["startedAt"], "completedAt": raw["completedAt"],
        "environment": raw["environment"], "model": raw["model"],
        "scoreThreshold": 0.5, "iouThreshold": 0.99,
        "reference": "ONNX Runtime Python + Pillow BICUBIC RGB /255",
        "combinations": summaries, "failureCaseCount": 10,
        "remaining": ["SOD 本模型的移动端验证", "模型卡许可与正式分发来源锁定", "小目标收益和同规模普通模型的公平对照"],
        "decision": "桌面四种组合和生命周期验证通过；保持 selected，优先 Worker，尚不进入稳定清单或公开 Demo。",
    }


def main():
    if len(sys.argv) == 2:
        data = Path(sys.argv[1]).read_bytes()
        raw = json.loads(data)
        summary = summarize(raw)
        compressed = gzip.compress(data, mtime=0)
        (report / "evidence/sod-lifecycle.json.gz").write_bytes(compressed)
        summary["evidence"] = {"path": "evidence/sod-lifecycle.json.gz", **digest(compressed), "uncompressed": digest(data)}
        (report / "ppyoloe-sod-lifecycle.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    else:
        summary = json.loads((report / "ppyoloe-sod-lifecycle.json").read_text(encoding="utf-8"))
        compressed = (report / summary["evidence"]["path"]).read_bytes()
        require(digest(compressed) == {k: summary["evidence"][k] for k in ("bytes", "sha256")}, "压缩摘要不符")
        data = gzip.decompress(compressed)
        require(digest(data) == summary["evidence"]["uncompressed"], "原始证据摘要不符")
        recalculated = summarize(json.loads(data))
        require(recalculated == {k: v for k, v in summary.items() if k != "evidence"}, "重新计算的结论与报告不符")
    print(json.dumps({"status": "通过", "combinations": [{k: r[k] for k in ("backend", "mode", "warmMedianMs", "pythonParity", "mainParity")} for r in summary["combinations"]]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
