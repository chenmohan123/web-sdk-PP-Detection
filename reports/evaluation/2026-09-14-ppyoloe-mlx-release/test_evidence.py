"""用归档副本验证发布证据拒绝机制，不修改原始结果或运行推理。"""
from __future__ import annotations
import contextlib
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mlx_release_summary', SOURCE/'summarize.py')
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


class ProtocolChecks(unittest.TestCase):
    def test_score_threshold_is_effective(self):
        box = {'image_id': 1, 'category_id': 1, 'bbox': [10, 10, 20, 20], 'score': 0.4}
        low = summary.parity([box], [box], [1], 0.5, 0.3)
        high = summary.parity([box], [box], [1], 0.5, 0.5)
        self.assertEqual(low['matchedCount'], 1)
        self.assertEqual(high['referenceCount'], 0)

    def test_duplicate_job_is_rejected(self):
        protocol = summary.read(SOURCE/'protocol.json')
        jobs = summary.read(summary.ROOT/protocol['jobs'])
        fixed = summary.read(summary.ROOT/protocol['round1']['report']/'summary.json')
        with self.assertRaisesRegex(ValueError, 'jobs 存在重复'):
            summary.validate_protocol_and_jobs(protocol, jobs+[copy.deepcopy(jobs[0])], fixed)

    def test_optimized_python_still_rejects(self):
        code = '''import importlib.util, sys
spec = importlib.util.spec_from_file_location("check", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.require(False, "优化模式必须拒绝")
'''
        result = subprocess.run([sys.executable, '-O', '-B', '-c', code, str(SOURCE/'summarize.py')],
            capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ValueError: 优化模式必须拒绝', result.stderr)


class ArchivedEvidenceChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = summary.read(SOURCE/'protocol.json')
        cls.baseline = summary.read(SOURCE/'summary.json')
        if not cls.baseline['qualityGatePassed'] or cls.baseline['browserRunCount'] != 54:
            raise RuntimeError('必须先完成三轮真实汇总，才能检查错误证据的拒绝机制')
        # 身份负例只复用已复算的指标，不重复运行 COCO；匹配函数仍执行真实匹配。
        cls.metrics = {}
        by_evidence = {row['evidenceSha256']: row['metrics'] for row in cls.baseline['rows']}
        for folder in (SOURCE, summary.ROOT/cls.protocol['round1']['report']):
            for entry in summary.read(folder/'artifact-index.json'):
                if entry['sha256'] not in by_evidence:
                    continue
                record = json.loads(gzip.decompress((folder/entry['path']).read_bytes()))
                cls.metrics[digest(encoded(record['predictions']))] = by_evidence[entry['sha256']]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mlx-release-evidence-test-')
        self.addCleanup(self.temp.cleanup)
        self.report = Path(self.temp.name)
        for name in ('protocol.json', 'artifact-index.json'):
            shutil.copyfile(SOURCE/name, self.report/name)
        shutil.copytree(SOURCE/'evidence', self.report/'evidence')

    def reject(self, pattern):
        def fixed_metrics(dataset, predictions, image_ids):
            return {'metrics': self.metrics[digest(encoded(predictions))]}
        with patch.object(summary, 'REPORT', self.report), patch.object(sys, 'argv', ['summarize.py']), \
             patch.object(summary, 'evaluate_coco', side_effect=fixed_metrics), \
             contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, pattern):
            summary.main()
        self.assertFalse((self.report/'summary.json').exists())

    def replace_record(self, relative, data):
        compressed = gzip.compress(data, mtime=0)
        (self.report/relative).write_bytes(compressed)
        index = summary.read(self.report/'artifact-index.json')
        entry = next(item for item in index if item['path'] == relative)
        entry.update(bytes=len(data), sha256=digest(data), compressedSha256=digest(compressed))
        (self.report/'artifact-index.json').write_bytes(encoded(index))

    def replace_result(self, round_no, stem, data):
        self.replace_record(f'evidence/round-{round_no}/{stem}.json.gz', data)
        binding = {'round': round_no, 'protocolSha256': digest((self.report/'protocol.json').read_bytes()), 'resultSha256': digest(data)}
        self.replace_record(f'evidence/round-{round_no}/{stem}-binding.json.gz', encoded(binding))

    def test_corrupt_gzip_is_rejected(self):
        target = self.report/'evidence/round-2/m-fp32-wasm.json.gz'
        data = bytearray(target.read_bytes())
        data[-1] ^= 1
        target.write_bytes(data)
        self.reject('压缩证据 SHA 不匹配')

    def test_rebuilt_index_cannot_replace_pinned_root(self):
        index = summary.ROOT/self.protocol['round1']['report']/'artifact-index.json'
        original_read = Path.read_bytes
        def replaced_read(path):
            data = original_read(path)
            return data+b' ' if path == index else data
        with patch.object(Path, 'read_bytes', replaced_read):
            self.reject('artifact-index.json 与固定提交')

    def test_rebound_duplicate_round_is_rejected(self):
        stem = 'm-fp32-wasm'
        data = gzip.decompress((self.report/f'evidence/round-2/{stem}.json.gz').read_bytes())
        self.replace_result(3, stem, data)
        self.reject('三轮 resultSha256 不互异')

    def test_wrong_protocol_binding_is_rejected(self):
        relative = 'evidence/round-2/m-fp32-wasm-binding.json.gz'
        value = json.loads(gzip.decompress((self.report/relative).read_bytes()))
        value['protocolSha256'] = '0'*64
        self.replace_record(relative, encoded(value))
        self.reject('协议绑定不一致')

    def test_changed_gpu_identity_is_rejected(self):
        stem = 'm-fp32-webgpu'
        relative = f'evidence/round-2/{stem}.json.gz'
        record = json.loads(gzip.decompress((self.report/relative).read_bytes()))
        record['environment']['gpu']['adapter']['device'] = '测试用不同设备'
        self.replace_result(2, stem, encoded(record))
        self.reject('WebGPU adapter 身份')


if __name__ == '__main__':
    unittest.main()