"""从本轮真实输出生成对照摘要，或仅使用压缩证据离线重算核验。"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
sys.path.insert(0, str(ROOT / "tools/model-pipeline"))
from evaluation import compare_detections, evaluate_coco


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def timing(values):
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.9
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return {"count": len(values), "medianMs": statistics.median(values), "p90Ms": ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)}


def parity(reference, candidate, ids):
    rows = [compare_detections([x for x in reference if x["image_id"] == image_id], [x for x in candidate if x["image_id"] == image_id], iou_threshold=0.99, score_threshold=0.5) for image_id in ids]
    result = {"images": len(ids), "iouThreshold": 0.99, "scoreThreshold": 0.5,
              "matchedCount": sum(x["matchedCount"] for x in rows),
              "unmatchedReferenceCount": sum(x["unmatchedReferenceCount"] for x in rows),
              "unmatchedCandidateCount": sum(x["unmatchedCandidateCount"] for x in rows),
              "maxBboxDeltaPixels": max((x["maxBboxDeltaPixels"] or 0) for x in rows),
              "maxScoreDelta": max((x["maxScoreDelta"] or 0) for x in rows)}
    require(result["unmatchedReferenceCount"] == result["unmatchedCandidateCount"] == 0, f"逐框核验不通过：{result}")
    return result


def compute(data):
    dataset = read(ROOT / "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json")
    annotation_bytes = (ROOT / "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json").read_bytes()
    inputs = read(REPORT / "inputs.json")
    require(inputs["annotations"] == digest(annotation_bytes), "标注摘要变化")
    ids = [image["id"] for image in dataset["images"]]
    cpu, browsers = {}, {}
    sdk_hash = None
    png_locks = {x["browserPng"]["fileName"]: x["browserPng"]["sha256"] for x in inputs["images"]}
    require(data["preparation.json"]["sourceSha256"] == "afd9c57b386a7b6c7c6b6d44aa6b383a9d537fc39b65cf6e5ddc2054e99cab4d", "普通 L 原始转换图摘要不符")
    require(data["preparation.json"]["outputSha256"] == inputs["models"]["ordinary"]["sha256"], "普通 L 图准备结果不符")
    for name in ("ordinary", "sod"):
        cpu[name] = {}
        for interpolation in ("opencv", "pillow"):
            runtime = data[f"{name}-{interpolation}-runtime.json"]
            predictions = data[f"{name}-{interpolation}-predictions.json"]
            require(runtime["modelSha256"] == inputs["models"][name]["sha256"], "Python 模型摘要不符")
            metrics = evaluate_coco(dataset, predictions, ids)
            require(metrics == runtime["evaluation"], "Python 质量报告无法重算复现")
            require([x["imageId"] for x in runtime["images"]] == ids, "Python 图片顺序不符")
            require(runtime["environment"]["backend"] == "CPUExecutionProvider" and runtime["environment"]["intraOpThreads"] == 4, "Python 实际后端或线程数不符")
            cpu[name][interpolation] = {"metrics": metrics["metrics"], "sessionMs": runtime["sessionMs"], "firstInferenceMs": runtime["images"][0]["inferenceMs"], "warmInference": timing([x["inferenceMs"] for x in runtime["images"][1:]]), "environment": runtime["environment"]}
        browsers[name] = {}
        for backend, expected_ids in (("webgpu", ids), ("wasm", ids[:8])):
            report = data[f"{name}-{backend}.json"]
            require(report["status"] == "passed", f"{name}/{backend} 运行失败")
            require(report["runtime"]["backend"] == backend and report["runtime"]["mode"] == "main" and not report["runtime"]["fallbacks"], "实际后端或执行模式不符")
            require(report["artifacts"]["model"]["sha256"] == inputs["models"][name]["sha256"], "浏览器模型摘要不符")
            require(report["artifacts"]["manifest"]["sha256"] == inputs["models"][name]["manifestSha256"], "浏览器清单摘要不符")
            require(report["runtimeVersions"] == {"onnxruntimeWeb": "1.27.0", "sdk": "0.4.0"}, "浏览器或 SDK 版本变化")
            require(report["evaluation"]["numThreads"] == 1 and report["evaluation"]["scoreThreshold"] == 0.001 and report["evaluation"]["manifestOverrides"] == {"iouThreshold": 1, "scoreThreshold": 0.001}, "浏览器统一评测配置不符")
            current_sdk = report["artifacts"]["sdk"]["sha256"]
            sdk_hash = sdk_hash or current_sdk
            require(current_sdk == sdk_hash, "两模型 SDK 构建不一致")
            require([x["imageId"] for x in report["images"]] == expected_ids, "图片数量或顺序不符")
            require(all(png_locks[x["fileName"]] == x["sha256"] for x in report["images"]), "浏览器实际图片摘要不符")
            if backend == "webgpu":
                require(report["environment"]["gpu"]["physical"], "WebGPU 非物理适配器")
            reference = data[f"{name}-pillow-predictions.json"]
            browsers[name][backend] = {"capturedAt": report["capturedAt"], "imageCount": len(expected_ids), "metrics": evaluate_coco(dataset, report["predictions"], expected_ids)["metrics"], "parity": parity(reference, report["predictions"], expected_ids), "sessionMs": report["performance"]["sessionMs"], "firstImageMs": report["performance"]["firstImageMs"], "warmTotal": timing([x["wallClockMs"] for x in report["images"][1:]]), "warmInference": timing([x["timings"]["inferenceMs"] for x in report["images"][1:]]), "environment": report["environment"], "runtime": report["runtime"]}
    reference = data["ordinary-paddle-reference.json"]
    paddle_predictions = data["ordinary-paddle-predictions.json"]
    paddle_metrics = evaluate_coco(dataset, paddle_predictions, ids)["metrics"]
    require(paddle_metrics == reference["evaluation"]["metrics"], "Paddle 指标重算不符")
    paddle_parity = parity(paddle_predictions, data["ordinary-opencv-predictions.json"], ids)
    delta = {}
    for environment, ordinary, sod in [
        ("pythonOpenCV", cpu["ordinary"]["opencv"]["metrics"], cpu["sod"]["opencv"]["metrics"]),
        ("pythonPillow", cpu["ordinary"]["pillow"]["metrics"], cpu["sod"]["pillow"]["metrics"]),
        ("browserWebGPU", browsers["ordinary"]["webgpu"]["metrics"], browsers["sod"]["webgpu"]["metrics"]),
    ]:
        delta[environment] = {key: 100 * (sod[key] - ordinary[key]) for key in ("AP", "AP50", "AP75", "APSmall", "APMedium", "APLarge")}
    return {"schemaVersion": 1, "date": "2026-09-13", "dataset": {key: inputs[key] for key in ("annotations", "imageCount", "groundTruthCount", "nonCrowdSmallCount", "imagesWithSmallObjects")}, "models": inputs["models"], "sizeIncreasePercent": 100 * (inputs["models"]["sod"]["bytes"] / inputs["models"]["ordinary"]["bytes"] - 1), "cpu": cpu, "browser": browsers, "ordinaryPaddleParity": paddle_parity, "ordinaryPaddleMetrics": paddle_metrics, "deltaPercentagePoints": delta, "sdkBundleSha256": sdk_hash, "limitations": ["64 图为固定场景子集，不代表完整 COCO 或统计显著性", "浏览器使用像素相等的 PNG，解码时间不是 JPEG 性能", "WASM 仅 8 图可用性和计时，不与 WebGPU 64 图 AP 混排", "每种配置仅一次顺序运行；冷启动样本不足以排名", "手机与正式分发均未增加兼容承诺"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    names = [f"{model}-{variant}-{kind}.json" for model in ("ordinary", "sod") for variant in ("opencv", "pillow") for kind in ("predictions", "runtime")]
    names += ["ordinary-paddle-reference.json", "ordinary-paddle-predictions.json"]
    names += [f"{model}-{backend}.json" for model in ("ordinary", "sod") for backend in ("webgpu", "wasm")]
    names += ["ordinary-manifest.json", "sod-manifest.json", "browser-annotations-64.json", "browser-annotations.json", "preparation.json"]
    names += ["export.log", "paddle2onnx.log", "paddle-reference.log"]
    data, evidence = {}, []
    if args.verify_only:
        for item in read(REPORT / "evidence-index.json"):
            compressed = (REPORT / item["path"]).read_bytes()
            require(digest(compressed) == item["compressed"], f"压缩证据摘要不符：{item['path']}")
            raw = gzip.decompress(compressed)
            require(digest(raw) == item["raw"], f"原始证据摘要不符：{item['path']}")
            if item["name"] in ("ordinary-manifest.json", "sod-manifest.json"):
                model_name = item["name"].split("-")[0]
                require(digest(raw)["sha256"] == read(REPORT / "inputs.json")["models"][model_name]["manifestSha256"], "归档清单与浏览器使用的清单不一致")
            if item["name"].endswith(".json"):
                data[item["name"]] = json.loads(raw.decode("utf-8-sig"))
        require(set(names) == {x["name"] for x in read(REPORT / "evidence-index.json")}, "压缩证据清单不完整")
    else:
        for name in names:
            raw = (ROOT / "work/sod-comparison" / name).read_bytes()
            compressed = gzip.compress(raw, mtime=0)
            path = REPORT / "evidence" / (name + ".gz")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(compressed)
            evidence.append({"name": name, "path": path.relative_to(REPORT).as_posix(), "compressed": digest(compressed), "raw": digest(raw)})
            if name.endswith(".json"):
                data[name] = json.loads(raw.decode("utf-8-sig"))
    summary = compute(data)
    if args.verify_only:
        require(summary == read(REPORT / "summary.json"), "汇总与压缩证据重算不一致")
        for item in read(REPORT / "reference-source.json")["files"]:
            require(digest(gzip.decompress((REPORT / item["snapshot"]).read_bytes())) == {k: item[k] for k in ("bytes", "sha256")}, "上游快照摘要不符")
        print("压缩证据、Python/浏览器指标、逐框对齐与摘要离线重算全部通过")
    else:
        for name, value in [("summary.json", summary), ("evidence-index.json", evidence)]:
            (REPORT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"delta": summary["deltaPercentagePoints"], "paddleParity": summary["ordinaryPaddleParity"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
