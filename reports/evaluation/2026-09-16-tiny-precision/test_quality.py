"""Tiny 精度评测的失败边界与证据身份测试。"""
import copy, json, unittest
from pathlib import Path
import quality

class QualityTests(unittest.TestCase):
    def test_protocol_rejects_missing_round_backend_and_duplicate_jobs(self):
        protocol = quality.read(quality.REPORT / "protocol.json")
        jobs = quality.read(quality.REPORT / "jobs.json")
        quality.validate_protocol_jobs(protocol, jobs)
        for field, value in (("rounds", [1, 2]), ("backends", ["wasm"]), ("models", [])):
            bad = copy.deepcopy(protocol); bad[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): quality.validate_protocol_jobs(bad, jobs)
        bad_jobs = copy.deepcopy(jobs); bad_jobs[-1] = bad_jobs[0]
        with self.assertRaises(ValueError): quality.validate_protocol_jobs(protocol, bad_jobs)

    def test_source_identity_rejects_wrong_digest(self):
        job = quality.read(quality.REPORT / "jobs.json")[0]
        bad = copy.deepcopy(job); bad["sourceSha256"] = "0" * 64
        with self.assertRaises(ValueError): quality.validate_job_source(bad)

    def test_evidence_identity_rejects_model_sdk_manifest_and_images(self):
        job = quality.read(quality.REPORT / "jobs.json")[0]
        lock = {"protocolSha256":"p", "environment":{"cpu":{},"os":{},"browser":{},"runtimeVersions":{}},
          "images":[{"fileName":f"{i}.jpg","imageId":i,"sha256":str(i)} for i in range(64)], "imageSetSha256":"set", "sdkSha256":"sdk",
          "models":{"ppyolo-tiny-320-fp32":{"manifestSha256":"manifest","modelId":"ppyolo-tiny-320","modelVersion":"0.1.0"}}, "gpuAdapter":{}}
        value = quality.synthetic_record(job, lock, "wasm")
        for path in (("artifacts","model","sha256"),("artifacts","manifest","sha256"),("artifacts","sdk","sha256"),("images",0,"sha256")):
            bad=copy.deepcopy(value); target=bad
            for key in path[:-1]: target=target[key]
            target[path[-1]]="bad"; raw=json.dumps(bad).encode(); binding={"round":1,"protocolSha256":"p","resultSha256":quality.sha(raw)}
            with self.subTest(path=path), self.assertRaises(ValueError): quality.validate_record(bad,binding,raw,job,"wasm",1,lock)

    def test_gate_boundaries_and_non_finite(self):
        self.assertTrue(quality.quality_pass(-0.5, 0.95))
        self.assertFalse(quality.quality_pass(-0.500001, 1.0))
        self.assertFalse(quality.quality_pass(0.0, 0.949999))
        self.assertFalse(quality.quality_pass(float("nan"), 1.0))

    def test_one_to_one_matching(self):
        box={"image_id":1,"category_id":1,"bbox":[0,0,10,10],"score":0.8}
        self.assertEqual(quality.parity([box,box],[box],[1],0.5)["fraction"],0.5)
        wrong={**box,"category_id":2}
        self.assertEqual(quality.parity([box],[wrong],[1],0.5)["fraction"],0.0)

if __name__ == "__main__": unittest.main()
