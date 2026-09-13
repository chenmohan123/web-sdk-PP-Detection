"""核对模型和固定图片，生成本轮专用的本地实验清单。"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

REPORT = Path(__file__).resolve().parent
ROOT = REPORT.parents[2]
sys.path.insert(0, str(ROOT / "tools/model-pipeline"))
from ppyoloe.build_manifest import build_runtime_manifest


def digest(path):
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-root", type=Path, required=True)
    args = parser.parse_args()
    cache = args.cache_root.resolve()
    work = ROOT / "work/sod-comparison"
    annotation_path = ROOT / "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json"
    annotations = json.loads(annotation_path.read_text(encoding="utf-8"))
    image_lock = json.loads(annotation_path.with_name("images.lock.json").read_text(encoding="utf-8"))
    images = []
    import cv2
    import numpy as np
    png_root = work / "images-png"
    png_root.mkdir(parents=True, exist_ok=True)
    for item in image_lock:
        source = cache / ".tmp/phase2/dataset/images" / item["filename"]
        actual = digest(source)
        if actual != {key: item[key] for key in ("bytes", "sha256")}:
            raise ValueError(f"图片摘要不符：{item['filename']}")
        decoded = cv2.imread(str(source))
        png = png_root / Path(item["filename"]).with_suffix(".png")
        if decoded is None or not cv2.imwrite(str(png), decoded) or not np.array_equal(decoded, cv2.imread(str(png))):
            raise ValueError(f"无损 PNG 像素不一致：{item['filename']}")
        images.append({"fileName": item["filename"], "imageId": item["imageId"], **actual, "browserPng": {"fileName": png.name, **digest(png)}, "decodedPixelsEqual": True})
    if len(images) != 64 or {x["imageId"] for x in images} != {x["id"] for x in annotations["images"]}:
        raise ValueError("图片锁与 64 图标注不一致")
    known = {
        "ordinary": (work / "ppyoloe-plus-l-candidate.onnx", "01f325d228676b0494e5eec45f10e2830dc9f81bf67a03157c24a0abf7824075", "ppyoloe-plus-l-640-coco"),
        "sod": (cache / ".tmp/sod-20260913/ppyoloe-sod-l-640-candidate.onnx", "a8fb0978485d42f78346339490302e4f3116daa2cdc7c192b2e2250b1675cd2e", "ppyoloe-sod-l-640-coco"),
    }
    models = {}
    import onnx
    from onnx import numpy_helper

    for name, (path, expected_sha, model_id) in known.items():
        actual = digest(path)
        if actual["sha256"] != expected_sha:
            raise ValueError(f"模型摘要不符：{name}")
        manifest = build_runtime_manifest(path, annotations, download_url=f"http://localhost/{path.name}")
        manifest["model"] = {"id": model_id, "version": "b25522a0-labs.1"}
        manifest["variants"][0]["id"] = f"{name}-l-fp32"
        (work / f"{name}-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        model = onnx.load(path)
        constants = {node.output[0]: numpy_helper.to_array(next(a.t for a in node.attribute if a.name == "value")) for node in model.graph.node if node.op_type == "Constant"}
        nms = next(node for node in model.graph.node if node.op_type == "NonMaxSuppression")
        thresholds = {"maxOutputBoxesPerClass": constants[nms.input[2]].tolist(), "iouThreshold": constants[nms.input[3]].tolist(), "scoreThreshold": constants[nms.input[4]].tolist()}
        models[name] = {**actual, "nmsConstants": thresholds, "manifestSha256": digest(work / f"{name}-manifest.json")["sha256"]}
    if models["ordinary"]["nmsConstants"] != models["sod"]["nmsConstants"]:
        raise ValueError("实际 ONNX NMS 设置不一致")
    small = [a for a in annotations["annotations"] if a["area"] < 32 ** 2 and not a.get("iscrowd", 0)]
    receipt = {"annotations": digest(annotation_path), "imageCount": len(images), "groundTruthCount": len(annotations["annotations"]), "nonCrowdSmallCount": len(small), "imagesWithSmallObjects": len({a["image_id"] for a in small}), "images": images, "models": models}
    (REPORT / "inputs.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    browser_annotations = {**annotations, "images": [{**image, "file_name": Path(image["file_name"]).with_suffix(".png").name} for image in annotations["images"]]}
    (work / "browser-annotations-64.json").write_text(json.dumps(browser_annotations, indent=2) + "\n", encoding="utf-8")
    subset = {**browser_annotations, "images": browser_annotations["images"][:8]}
    ids = {image["id"] for image in subset["images"]}
    subset["annotations"] = [a for a in annotations["annotations"] if a["image_id"] in ids]
    (work / "browser-annotations.json").write_text(json.dumps(subset, indent=2) + "\n", encoding="utf-8")
    print("模型、64 图锁和 NMS 设置已核验，已生成两份本地 labs 清单")


if __name__ == "__main__":
    main()
