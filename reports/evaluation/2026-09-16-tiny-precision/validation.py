"""对原始评测补充身份和数值验证，不改变运行协议或预测数据。"""
import hashlib
import json
import math


def require(value, message):
    if not value:
        raise ValueError(message)


def validate_annotations(value, lock):
    require(len(value["images"]) == 64 and len(value["annotations"]) == 716, "标注数量错误")
    require([row["id"] for row in value["images"]] ==
            [row["imageId"] for row in lock["images"]], "标注图片ID错误")


def load_annotations(path, expected_sha, lock):
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha, "实际标注摘要错误")
    value = json.loads(raw)
    validate_annotations(value, lock)
    return value


def expected_evaluation(backend, precision):
    return {
        "allowExperimental": True,
        "allowFallback": False,
        "executionMode": "main",
        "expectedImages": 64,
        "manifestOverrides": {"iouThreshold": 1, "scoreThreshold": .001},
        "numThreads": 1,
        "preprocessing": {"interpolation": "bicubic", "reference": "Pillow bicubic"},
        "requestedBackend": backend,
        "precision": "int8" if precision == "w8a32" else precision,
        "scoreThreshold": .001,
    }


def validate_evaluation(value, backend, precision):
    require(value.get("evaluation") == expected_evaluation(backend, precision), "评测配置错误")


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_timings(value):
    for image in value["images"]:
        require(finite_number(image["wallClockMs"]) and image["wallClockMs"] >= 0, "图片耗时错误")
        times = image.get("timings", {})
        require("inferenceMs" in times, "缺少推理耗时")
        require(all(finite_number(number) and number >= 0 for number in times.values()), "推理耗时必须有限且非负")


def validate_cpu(value, jobs):
    require(value.get("input") == {"shape": [1, 3, 320, 320], "dtype": "float32", "fixture": "all-zero"}, "CPU输入契约错误")
    rows = value.get("runs", [])
    expected = {job["precision"]: job for job in jobs}
    require(len(rows) == 3 and {row["precision"] for row in rows} == set(expected), "CPU精度缺失或重复")
    for row in rows:
        require(row["modelSha256"] == expected[row["precision"]]["sha256"], "CPU模型摘要错误")
        require(row["provider"] == ["CPUExecutionProvider"], "CPU执行器错误")
        outputs = row["outputs"]
        require(len(outputs) == 2, "CPU输出数量错误")
        detections, count = outputs
        shape = detections["shape"]
        require(len(shape) == 2 and isinstance(shape[0], int) and shape[0] >= 0 and shape[1] == 6,
                "CPU检测输出形状错误")
        require(detections["dtype"] == "float32" and detections["finite"] is True, "CPU检测输出类型或有限值错误")
        require(count == {"shape": [1], "dtype": "int32", "finite": True}, "CPU计数输出契约错误")


def validate_session(session):
    inputs, outputs = session.get_inputs(), session.get_outputs()
    require(len(inputs) == 1 and inputs[0].name == "image" and inputs[0].type == "tensor(float)"
            and inputs[0].shape == [1, 3, 320, 320], "CPU会话输入契约错误")
    require(len(outputs) == 2 and outputs[0].type == "tensor(float)"
            and len(outputs[0].shape) == 2 and outputs[0].shape[1] == 6
            and outputs[1].type == "tensor(int32)" and outputs[1].shape == [1], "CPU会话输出契约错误")
