from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import onnx
import onnxruntime as ort
import pytest
from onnx import TensorProto, helper, numpy_helper

from evaluation.prepare_subset import build_subset, select_image_ids, verify_image_lock
from ppyoloe.build_manifest import build_runtime_manifest
from ppyoloe.export import export_paddle, paddle2onnx_command
from ppyoloe.fix_onnx import repair_onnx
from ppyoloe.inference import detections_to_coco, preprocess_image
from ppyoloe.sources import verify_file


def _dataset() -> dict:
    images = [
        {"id": 101, "file_name": "101.jpg", "width": 100, "height": 80, "license": 1},
        {"id": 202, "file_name": "202.jpg", "width": 200, "height": 100, "license": 1},
        {"id": 303, "file_name": "303.jpg", "width": 50, "height": 50, "license": 1},
    ]
    return {
        "info": {"description": "测试数据"},
        "licenses": [{"id": 1, "name": "测试许可", "url": "https://example.com/license"}],
        "images": images,
        "categories": [{"id": 1, "name": "person"}, {"id": 9, "name": "boat"}, {"id": 90, "name": "toothbrush"}],
        "annotations": [
            {"id": 1, "image_id": 101, "category_id": 1, "bbox": [1, 2, 3, 4], "area": 12, "iscrowd": 0, "segmentation": [[1, 2, 3, 4, 5, 6]]},
            {"id": 2, "image_id": 202, "category_id": 9, "bbox": [2, 3, 20, 10], "area": 200, "iscrowd": 1, "ignore": 1},
            {"id": 3, "image_id": 303, "category_id": 90, "bbox": [0, 0, 2, 2], "area": 4, "iscrowd": 0},
        ],
    }


def test_select_image_ids_is_seeded_and_boat_counts_as_vehicle() -> None:
    selection = select_image_ids(_dataset(), seed="pp-detection-phase2-v1", count=3, bucket_size=1)
    assert selection["imageIds"] == [101, 202, 303]
    assert selection["selectionReasons"]["202"] == "vehicle"


def test_build_subset_preserves_original_category_ids_and_bbox_flags() -> None:
    subset = build_subset(_dataset(), [202])
    assert [item["id"] for item in subset["categories"]] == [1, 9, 90]
    assert subset["annotations"] == [
        {"id": 2, "image_id": 202, "category_id": 9, "bbox": [2, 3, 20, 10], "area": 200, "iscrowd": 1, "ignore": 1}
    ]
    assert "segmentation" not in subset["annotations"][0]


def test_image_lock_rejects_changed_file(tmp_path: Path) -> None:
    image = tmp_path / "202.jpg"
    image.write_bytes(b"correct")
    lock = [{"imageId": 202, "filename": image.name, "bytes": 7, "sha256": hashlib.sha256(b"correct").hexdigest()}]
    verify_image_lock(tmp_path, lock)
    image.write_bytes(b"changed")
    with pytest.raises(ValueError, match="SHA-256"):
        verify_image_lock(tmp_path, lock)


def test_source_verification_rejects_wrong_bytes_and_digest(tmp_path: Path) -> None:
    artifact = tmp_path / "model.bin"
    artifact.write_bytes(b"model")
    digest = hashlib.sha256(b"model").hexdigest()
    assert verify_file(artifact, expected_bytes=5, expected_sha256=digest)["sha256"] == digest
    with pytest.raises(ValueError, match="字节数"):
        verify_file(artifact, expected_bytes=6, expected_sha256=digest)
    with pytest.raises(ValueError, match="SHA-256"):
        verify_file(artifact, expected_bytes=5, expected_sha256="0" * 64)


def test_export_uses_opset_11_and_rejects_unpinned_upstream(tmp_path: Path) -> None:
    assert paddle2onnx_command(Path("exported"), Path("candidate.onnx")) == [
        str(Path(sys.executable).parent / ("paddle2onnx.exe" if sys.platform == "win32" else "paddle2onnx")), "--model_dir", "exported", "--model_filename", "model.pdmodel",
        "--params_filename", "model.pdiparams", "--opset_version", "11", "--save_file", "candidate.onnx",
    ]
    with pytest.raises(ValueError, match="上游目录"):
        export_paddle(upstream=tmp_path / "PaddleDetection-main", weights=tmp_path / "weights", output_dir=tmp_path / "out", temp_dir=tmp_path / "temp")


def _make_nms_model(path: Path, *, wrong_topology: bool = False, runtime_outputs: bool = False, unnamed_nodes: bool = False) -> None:
    inputs = [
        helper.make_tensor_value_info("image", TensorProto.FLOAT, ["batch", 3, 640, 640]),
        helper.make_tensor_value_info("scale_factor", TensorProto.FLOAT, ["batch", 2]),
    ]
    boxes = numpy_helper.from_array(np.array([[[0, 0, 10, 10], [20, 20, 30, 30], [40, 40, 50, 50]]], dtype=np.float32), "boxes")
    scores = numpy_helper.from_array(np.array([[[0.9, 0.8, 0.1], [0.1, 0.1, 0.95]]], dtype=np.float32), "scores")
    max_output = numpy_helper.from_array(np.array([3], dtype=np.int64), "max_output")
    iou = numpy_helper.from_array(np.array([0.5], dtype=np.float32), "iou")
    threshold = numpy_helper.from_array(np.array([0.5], dtype=np.float32), "threshold")
    class_column = numpy_helper.from_array(np.array([1], dtype=np.int64), "class_column")
    box_column = numpy_helper.from_array(np.array([2], dtype=np.int64), "box_column")
    nodes = [
        helper.make_node("NonMaxSuppression", ["boxes", "scores", "max_output", "iou", "threshold"], ["nms.selected_index.0"], name="NonMaxSuppression.0"),
        helper.make_node("Gather", ["nms.selected_index.0", "class_column"], ["Gather.1"], name="Gather.0", axis=1),
        helper.make_node("Gather", ["nms.selected_index.0", "box_column"], ["Gather.3"], name="Gather.2", axis=1),
        helper.make_node("Squeeze", ["wrong" if wrong_topology else "Gather.1"], ["class_ids"], name="Squeeze.3"),
        helper.make_node("Squeeze", ["Gather.3"], ["box_ids"], name="Squeeze.5"),
    ]
    if unnamed_nodes:
        nodes.extend([
            helper.make_node("Identity", ["class_ids"], ["unused_class"]),
            helper.make_node("Identity", ["box_ids"], ["unused_box"]),
        ])
    initializers = [boxes, scores, max_output, iou, threshold, class_column, box_column]
    if runtime_outputs:
        initializers.extend([
            numpy_helper.from_array(np.array([[0, 0.9, 1, 2, 3, 4]], dtype=np.float32), "detections"),
            numpy_helper.from_array(np.array([1], dtype=np.int32), "count"),
        ])
        outputs = [
            helper.make_tensor_value_info("detections", TensorProto.FLOAT, [None, 6]),
            helper.make_tensor_value_info("count", TensorProto.INT32, [None]),
        ]
    else:
        outputs = [
            helper.make_tensor_value_info("class_ids", TensorProto.INT64, [None]),
            helper.make_tensor_value_info("box_ids", TensorProto.INT64, [None]),
        ]
    graph = helper.make_graph(nodes, "严格 NMS 测试图", inputs, outputs, initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 11)])
    onnx.save(model, path)


def test_repair_onnx_fixes_only_expected_nms_squeezes_and_keeps_detection_axis(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    _make_nms_model(source)
    report = repair_onnx(source, output)
    assert report["changes"] == ["image_batch=1", "scale_factor=initializer[[1,1]]", "Squeeze.3.axes=[1]", "Squeeze.5.axes=[1]"]
    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    assert [(item.name, item.shape) for item in session.get_inputs()] == [("image", [1, 3, 640, 640])]
    class_ids, box_ids = session.run(None, {"image": np.zeros((1, 3, 640, 640), dtype=np.float32)})
    assert class_ids.shape == (3,)
    assert box_ids.shape == (3,)


def test_repair_onnx_rejects_unknown_topology(tmp_path: Path) -> None:
    source = tmp_path / "wrong.onnx"
    _make_nms_model(source, wrong_topology=True)
    with pytest.raises(ValueError, match="Squeeze.3"):
        repair_onnx(source, tmp_path / "output.onnx")


def test_repair_onnx_rejects_wrong_nms_selected_column(tmp_path: Path) -> None:
    source = tmp_path / "wrong-column.onnx"
    _make_nms_model(source)
    model = onnx.load(source)
    replacement = numpy_helper.from_array(np.array([0], dtype=np.int64), "class_column")
    index = next(index for index, item in enumerate(model.graph.initializer) if item.name == "class_column")
    model.graph.initializer[index].CopyFrom(replacement)
    onnx.save(model, source)
    with pytest.raises(ValueError, match="class.*列|Gather.0"):
        repair_onnx(source, tmp_path / "output.onnx")


def test_repair_onnx_accepts_legal_unnamed_nodes(tmp_path: Path) -> None:
    source = tmp_path / "unnamed.onnx"
    _make_nms_model(source, unnamed_nodes=True)
    repair_onnx(source, tmp_path / "output.onnx")


def test_repair_onnx_preserves_single_detection_dimension(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    _make_nms_model(source)
    model = onnx.load(source)
    replacement = numpy_helper.from_array(np.array([[[0.9, 0.1, 0.1], [0.1, 0.1, 0.1]]], dtype=np.float32), "scores")
    index = next(index for index, item in enumerate(model.graph.initializer) if item.name == "scores")
    model.graph.initializer[index].CopyFrom(replacement)
    onnx.save(model, source)
    repair_onnx(source, output)
    class_ids, box_ids = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"]).run(None, {"image": np.zeros((1, 3, 640, 640), dtype=np.float32)})
    assert class_ids.shape == (1,)
    assert box_ids.shape == (1,)


def test_manifest_uses_actual_signature_hash_and_original_coco_order(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    model_path = tmp_path / "candidate.onnx"
    _make_nms_model(source, runtime_outputs=True)
    repair_onnx(source, model_path)
    manifest = build_runtime_manifest(model_path, _dataset(), download_url="http://localhost:4173/candidate.onnx")
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    assert manifest["input"] == {"name": "image", "shape": [1, 3, 640, 640], "dtype": "float32"}
    assert manifest["outputs"] == [
        {"name": "detections", "shape": [-1, 6], "dtype": "float32"},
        {"name": "count", "shape": [1], "dtype": "int32"},
    ]
    assert manifest["labels"] == ["person", "boat", "toothbrush"]
    assert manifest["variants"][0]["status"] == "labs"
    assert manifest["variants"][0]["sources"][0]["revision"] == digest
    assert manifest["postprocessing"] == {"type": "nms", "scoreThreshold": 0.001, "iouThreshold": 1.0, "matrixCoordinates": "pixels", "queryCoordinates": "pixels", "queryBoxFormat": "xyxy"}


def test_preprocessing_distinguishes_opencv_and_pillow_bicubic() -> None:
    pixels = np.zeros((3, 5, 3), dtype=np.uint8)
    pixels[1, 2] = [255, 128, 32]
    opencv = preprocess_image(pixels, model="ppyoloe", size=8)
    pillow = preprocess_image(pixels, model="ppyoloe-pillow", size=8)
    assert opencv.shape == (1, 3, 8, 8)
    assert pillow.shape == (1, 3, 8, 8)
    assert not np.array_equal(opencv, pillow)
    assert 0 <= float(opencv.min()) <= float(opencv.max()) <= 1


def test_detection_rows_map_class_indexes_to_non_contiguous_coco_ids() -> None:
    rows = np.array([[1, 0.75, 10, 20, 50, 60]], dtype=np.float32)
    predictions = detections_to_coco(rows, image={"id": 7, "width": 200, "height": 100}, category_ids=[1, 9, 90], input_size=100)
    assert predictions == [{"image_id": 7, "category_id": 9, "bbox": [20.0, 20.0, 80.0, 40.0], "score": 0.75}]


def test_inference_cli_can_run_directly_by_file_path() -> None:
    script = Path(__file__).parents[1] / "ppyoloe" / "inference.py"
    completed = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    assert "--model-kind" in completed.stdout


def test_repair_rejects_unexpected_squeeze_axes(tmp_path: Path) -> None:
    source = tmp_path / "unknown-axes.onnx"
    _make_nms_model(source)
    model = onnx.load(source)
    node = next(item for item in model.graph.node if item.name == "Squeeze.3")
    node.attribute.append(helper.make_attribute("axes", [0]))
    onnx.save(model, source)
    with pytest.raises(ValueError, match="Squeeze.3.*axes"):
        repair_onnx(source, tmp_path / "output.onnx")
