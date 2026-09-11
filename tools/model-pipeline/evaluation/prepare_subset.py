from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

DEFAULT_SEED = "pp-detection-phase2-v1"
BUCKETS: tuple[tuple[str, Callable[[list[dict[str, Any]]], bool]], ...] = (
    ("person", lambda items: any(item["category_id"] == 1 for item in items)),
    ("vehicle", lambda items: any(item["category_id"] in {2, 3, 4, 5, 6, 7, 8, 9} for item in items)),
    ("animal", lambda items: any(item["category_id"] in set(range(16, 26)) for item in items)),
    ("small", lambda items: any(float(item.get("area", 0)) < 32**2 for item in items)),
    ("dense", lambda items: len(items) >= 10),
    ("crowd", lambda items: any(bool(item.get("iscrowd", 0)) for item in items)),
)


def _seed_key(seed: str, image_id: int) -> str:
    return hashlib.sha256(f"{seed}:{image_id}".encode("utf-8")).hexdigest()


def select_image_ids(dataset: dict[str, Any], *, seed: str = DEFAULT_SEED, count: int = 64, bucket_size: int = 8) -> dict[str, Any]:
    if count < 1 or bucket_size < 0:
        raise ValueError("count 必须为正整数，bucket_size 不得为负数")
    image_ids = [int(item["id"]) for item in dataset.get("images", [])]
    if len(image_ids) != len(set(image_ids)):
        raise ValueError("数据集包含重复图片 ID")
    annotations_by_image: dict[int, list[dict[str, Any]]] = {image_id: [] for image_id in image_ids}
    for annotation in dataset.get("annotations", []):
        image_id = int(annotation["image_id"])
        if image_id not in annotations_by_image:
            raise ValueError(f"标注引用未知图片 {image_id}")
        annotations_by_image[image_id].append(annotation)

    selected: list[int] = []
    reasons: dict[int, str] = {}
    ordered_ids = sorted(image_ids, key=lambda image_id: _seed_key(seed, image_id))
    for bucket_name, predicate in BUCKETS:
        bucket_count = 0
        for image_id in ordered_ids:
            if image_id in reasons or not predicate(annotations_by_image[image_id]):
                continue
            selected.append(image_id)
            reasons[image_id] = bucket_name
            bucket_count += 1
            if bucket_count == bucket_size:
                break
    for image_id in ordered_ids:
        if len(selected) >= count:
            break
        if image_id not in reasons:
            selected.append(image_id)
            reasons[image_id] = "seeded-remainder"
    if len(selected) != count:
        raise ValueError(f"数据集只有 {len(selected)} 张可选图片，无法生成 {count} 张子集")
    return {
        "seed": seed,
        "imageIds": sorted(selected),
        "selectionReasons": {str(image_id): reasons[image_id] for image_id in selected},
    }


def build_subset(dataset: dict[str, Any], image_ids: list[int]) -> dict[str, Any]:
    selected = set(image_ids)
    images = [item.copy() for item in dataset.get("images", []) if int(item["id"]) in selected]
    if {int(item["id"]) for item in images} != selected:
        missing = sorted(selected - {int(item["id"]) for item in images})
        raise ValueError(f"选择包含未知图片：{missing}")
    annotation_fields = ("id", "image_id", "category_id", "bbox", "area", "iscrowd", "ignore")
    annotations = [
        {key: item[key] for key in annotation_fields if key in item}
        for item in dataset.get("annotations", [])
        if int(item["image_id"]) in selected
    ]
    return {
        "info": dataset.get("info", {}).copy(),
        "licenses": [item.copy() for item in dataset.get("licenses", [])],
        "images": images,
        "annotations": annotations,
        "categories": [item.copy() for item in dataset.get("categories", [])],
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_image_lock(dataset: dict[str, Any], image_ids: list[int], images_dir: Path) -> list[dict[str, Any]]:
    licenses = {int(item["id"]): item for item in dataset.get("licenses", [])}
    images = {int(item["id"]): item for item in dataset.get("images", [])}
    result = []
    for image_id in sorted(image_ids):
        image = images[image_id]
        path = images_dir / image["file_name"]
        if not path.is_file():
            raise FileNotFoundError(path)
        result.append({
            "imageId": image_id,
            "filename": image["file_name"],
            "width": image["width"],
            "height": image["height"],
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "sourceUrl": f"https://s3.amazonaws.com/images.cocodataset.org/val2017/{image['file_name']}",
            "license": licenses[int(image["license"])].copy(),
            "cocoUrl": image.get("coco_url"),
            "flickrUrl": image.get("flickr_url"),
        })
    return result


def verify_image_lock(images_dir: Path, lock: list[dict[str, Any]]) -> None:
    for item in lock:
        path = images_dir / str(item["filename"])
        if not path.is_file():
            raise ValueError(f"图片不存在：{path}")
        if path.stat().st_size != item["bytes"]:
            raise ValueError(f"图片 {path.name} 字节数不匹配")
        if sha256_file(path) != str(item["sha256"]).lower():
            raise ValueError(f"图片 {path.name} SHA-256 不匹配")


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="重建并校验固定 COCO val2017 评测子集")
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--expected-selection", type=Path)
    parser.add_argument("--expected-images-lock", type=Path)
    args = parser.parse_args()
    try:
        raw = args.annotations.read_bytes()
        dataset = json.loads(raw)
        selection = select_image_ids(dataset)
        selection["annotationsSha256"] = hashlib.sha256(raw).hexdigest()
        if args.expected_selection:
            expected = json.loads(args.expected_selection.read_text(encoding="utf-8"))
            if selection != expected:
                raise ValueError("重建的选择与预期 selection 不一致")
        lock = build_image_lock(dataset, selection["imageIds"], args.images_dir)
        if args.expected_images_lock:
            expected_lock = json.loads(args.expected_images_lock.read_text(encoding="utf-8"))
            if lock != expected_lock:
                raise ValueError("重建的图片锁与预期 images.lock 不一致")
        verify_image_lock(args.images_dir, lock)
        _write_json(args.output_dir / "selection.json", selection)
        _write_json(args.output_dir / "image-ids.json", selection["imageIds"])
        _write_json(args.output_dir / "images.lock.json", lock)
        _write_json(args.output_dir / "annotations.json", build_subset(dataset, selection["imageIds"]))
    except Exception as exc:
        print(f"子集重建失败：{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
