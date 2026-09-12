"""归档本次预处理对照；从仓库根目录运行，参数为原始报告目录、归档目录。"""
from pathlib import Path
import gzip
import hashlib
import json
import math
import statistics
import sys

sys.path.insert(0, "tools/model-pipeline")
from evaluation.coco import evaluate_coco

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
annotations = json.loads(Path("reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json").read_text(encoding="utf8"))
image_ids = [x["id"] for x in annotations["images"]]
runs, raw_runs, quality_cache = {}, {}, {}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")

def percentile(values, fraction):
    values = sorted(values)
    index = (len(values) - 1) * fraction
    lo, hi = math.floor(index), math.ceil(index)
    return values[lo] + (values[hi] - values[lo]) * (index - lo)

for model in ["ppyoloe", "picodet"]:
    for backend in ["webgpu", "wasm"]:
        for round_number in range(1, 4 if (model, backend) == ("ppyoloe", "webgpu") else 2):
            for variant in ["baseline", "candidate"]:
                name = f"{model}-{backend}-{variant}-{round_number}"
                data = (source / f"{name}.json").read_bytes()
                report = json.loads(data)
                runtime = report["runtime"]
                assert report["status"] == "passed"
                assert [x["imageId"] for x in report["images"]] == image_ids
                assert runtime["backend"] == runtime["requestedBackend"] == backend
                assert runtime["fallbacks"] == [] and runtime["mode"] == "main"
                predictions = report["predictions"]
                payload = json.dumps(predictions, separators=(",", ":")).encode()
                digest = sha(payload)
                relative = f"predictions/{digest}.json.gz"
                compressed = gzip.compress(payload, mtime=0)
                (destination / "predictions").mkdir(exist_ok=True)
                (destination / relative).write_bytes(compressed)
                if digest not in quality_cache:
                    quality_cache[digest] = evaluate_coco(annotations, predictions, image_ids)
                stats = {
                    metric: {"median": percentile([x["timings"][metric] for x in report["images"][1:]], .5),
                             "p90": percentile([x["timings"][metric] for x in report["images"][1:]], .9)}
                    for metric in ["decodeMs", "preprocessMs", "inferenceMs", "postprocessMs", "totalMs"]
                }
                raw_runs[name] = report
                archived = {key: value for key, value in report.items() if key != "predictions"}
                archived["predictionsReference"] = {"path": "../" + relative, "jsonSha256": digest,
                    "gzipSha256": sha(compressed), "count": len(predictions)}
                save(destination / "runtime" / f"{name}.json", archived)
                runs[name] = {"sourceSha256": sha(data), "runtime": f"runtime/{name}.json",
                    "artifacts": report["artifacts"], "predictions": archived["predictionsReference"],
                    "quality": quality_cache[digest], "warmImages": 63, "warm": stats,
                    "sessionMs": report["loadTimings"]["sessionMs"],
                    "firstImageMs": report["images"][0]["timings"]["totalMs"]}

comparisons = {}
for model in ["ppyoloe", "picodet"]:
    for backend in ["webgpu", "wasm"]:
        pairs = []
        for round_number in range(1, 4 if (model, backend) == ("ppyoloe", "webgpu") else 2):
            left = f"{model}-{backend}-baseline-{round_number}"
            right = f"{model}-{backend}-candidate-{round_number}"
            a, b = raw_runs[left], raw_runs[right]
            assert a["predictions"] == b["predictions"], (left, right)
            assert a["artifacts"]["sdk"]["sha256"] != b["artifacts"]["sdk"]["sha256"]
            for artifact in ["annotations", "manifest", "model"]:
                assert a["artifacts"][artifact]["sha256"] == b["artifacts"][artifact]["sha256"]
            assert a["artifacts"]["imageSetSha256"] == b["artifacts"]["imageSetSha256"]
            pairs.append({"baseline": left, "candidate": right, "predictionsExactlyEqual": True})
        aggregates = {}
        for variant in ["baseline", "candidate"]:
            selected = [runs[pair[variant]] for pair in pairs]
            aggregates[variant] = {
                "warm": {metric: {p: statistics.median(x["warm"][metric][p] for x in selected)
                                  for p in ["median", "p90"]}
                         for metric in selected[0]["warm"]},
                "sessionMs": statistics.median(x["sessionMs"] for x in selected),
                "firstImageMs": statistics.median(x["firstImageMs"] for x in selected)
            }
        reductions = {metric: (1 - aggregates["candidate"]["warm"][metric]["median"] /
                                aggregates["baseline"]["warm"][metric]["median"]) * 100
                      for metric in ["preprocessMs", "inferenceMs", "totalMs"]}
        comparisons[f"{model}-{backend}"] = {"pairs": pairs, **aggregates, "reductionPercent": reductions}

summary = {"date": "2026-09-12", "baselineCommit": "45cf9be",
    "scope": "主线程 FP32；每轮 64 图，热值排除首图，三轮时取每轮统计量的中位数；预测按原顺序逐项完全相等。",
    "runs": runs, "comparisons": comparisons}
save(destination / "summary.json", summary)
print(json.dumps({name: {"reductions": value["reductionPercent"],
    "baseline": value["baseline"], "candidate": value["candidate"]}
    for name, value in comparisons.items()}, ensure_ascii=False))
print(json.dumps({name: {"AP": value["quality"]["metrics"]["AP"], "count": value["quality"]["predictionCount"]}
    for name, value in runs.items() if name.endswith("baseline-1")}))
