"""针对真实归档的拒绝边界回归测试。"""
import copy
import gzip
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import summarize
import validation


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.jobs = summarize.read(summarize.REPORT / "jobs.json")
        self.cpu = summarize.read(summarize.REPORT / "cpu-validation.json")
        self.lock = summarize.read(summarize.REPORT / "inputs.lock.json")
        path = summarize.REPORT / "evidence/round-1/ppyolo-tiny-320-fp32-wasm.json.gz"
        self.record = json.loads(gzip.decompress(path.read_bytes()))

    def test_annotations_changed_cannot_reissue_receipt(self):
        validation.load_annotations(summarize.ANNOTATIONS, summarize.ANNOTATIONS_SHA, self.lock)
        original = Path.read_bytes
        changed = json.loads(original(summarize.ANNOTATIONS))
        changed["annotations"].pop()
        def read_bytes(path):
            return json.dumps(changed).encode() if path == summarize.ANNOTATIONS else original(path)
        with patch.object(Path, "read_bytes", read_bytes), patch.object(Path, "write_text") as write:
            with self.assertRaisesRegex(ValueError, "标注摘要"):
                summarize.summarize(False)
            write.assert_not_called()

    def test_annotation_counts_and_ids(self):
        raw = summarize.ANNOTATIONS.read_bytes()
        value = json.loads(raw)
        value["annotations"].pop()
        with self.assertRaisesRegex(ValueError, "标注数量"):
            validation.validate_annotations(value, self.lock)
        value = json.loads(raw)
        value["images"][0]["id"] = -1
        with self.assertRaisesRegex(ValueError, "图片ID"):
            validation.validate_annotations(value, self.lock)

    def test_evaluation_settings_from_valid_record(self):
        validation.validate_evaluation(self.record, "wasm", "fp32")
        for key, value in (("scoreThreshold", .9), ("numThreads", 8),
                           ("manifestOverrides", {"scoreThreshold": .9, "iouThreshold": .1})):
            changed = copy.deepcopy(self.record)
            changed["evaluation"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "评测配置"):
                validation.validate_evaluation(changed, "wasm", "fp32")

    def test_inference_timing_finite_and_nonnegative(self):
        validation.validate_timings(self.record)
        for value in (float("nan"), float("inf"), -float("inf"), -1):
            changed = copy.deepcopy(self.record)
            changed["images"][1]["timings"]["inferenceMs"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "耗时"):
                validation.validate_timings(changed)

    def test_gate_rejects_invalid_retention(self):
        self.assertTrue(summarize.quality_pass(-.5, .95))
        for value in (float("nan"), float("inf"), -float("inf"), -1, 1.01):
            self.assertFalse(summarize.quality_pass(0, value))

    def test_cpu_results_start_from_valid_record(self):
        validation.validate_cpu(self.cpu, self.jobs)
        for kind in ("finite", "dtype", "shape", "missing", "sha", "provider"):
            changed = copy.deepcopy(self.cpu)
            if kind == "missing": changed["runs"].pop()
            elif kind == "sha": changed["runs"][0]["modelSha256"] = "0" * 64
            elif kind == "provider": changed["runs"][0]["provider"] = ["CUDAExecutionProvider"]
            else: changed["runs"][0]["outputs"][0][kind] = {"finite": False, "dtype": "float16", "shape": [1, 5]}[kind]
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "CPU"):
                validation.validate_cpu(changed, self.jobs)


if __name__ == "__main__":
    unittest.main()
