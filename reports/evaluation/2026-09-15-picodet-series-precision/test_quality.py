"""使用真实 FP32 记录的内存副本验证坏证据会被拒绝。"""
import copy
import gzip
import json
import subprocess
import sys
import unittest
from pathlib import Path
import quality

class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.job = next(j for j in quality.read(quality.REPORT / 'jobs.json') if j['key'] == 'picodet-xs-320' and j['precision'] == 'fp32')
        archive = quality.REPORT / 'evidence/round-1/picodet-xs-320-fp32-webgpu.json.gz'
        cls.value = json.loads(gzip.decompress(archive.read_bytes()))
        v = cls.value
        cls.lock = {'protocolSha256': quality.sha((quality.REPORT / 'protocol.json').read_bytes()), 'environment': quality.environment(v),
          'images': [{k:x[k] for k in ('fileName', 'imageId', 'sha256')} for x in v['images']], 'imageSetSha256': v['artifacts']['imageSetSha256'],
          'sdkSha256': v['artifacts']['sdk']['sha256'], 'models': {'picodet-xs-320-fp32': {'manifestSha256': v['artifacts']['manifest']['sha256'], 'modelId': v['model']['id'], 'modelVersion': v['model']['version']}},
          'gpuAdapter': v['environment']['gpu']['adapter']}

    def validate(self, v):
        raw = json.dumps(v).encode()
        binding = {'round': 1, 'protocolSha256': self.lock['protocolSha256'], 'resultSha256': quality.sha(raw)}
        return quality.validate_record(v, binding, raw, self.job, 'webgpu', 1, self.lock)

    def test_valid(self):
        self.validate(self.value)

    def test_changed_fields_rejected(self):
        cases = [('artifacts','model','sha256'), ('artifacts','manifest','sha256'), ('artifacts','sdk','sha256'), ('artifacts','annotations','sha256'), ('runtime','backend'), ('model','precision'), ('evaluation','scoreThreshold'), ('environment','gpu','physical')]
        for path in cases:
            with self.subTest(path=path):
                value = copy.deepcopy(self.value)
                target = value
                for p in path[:-1]: target = target[p]
                target[path[-1]] = '错误'
                with self.assertRaises(ValueError): self.validate(value)

    def test_missing_duplicate_or_modified_images(self):
        for edit in ('missing','duplicate','sha'):
            value=copy.deepcopy(self.value)
            if edit=='missing': value['images'].pop()
            elif edit=='duplicate': value['images'][-1] = value['images'][0]
            else: value['images'][0]['sha256']='0'*64
            with self.assertRaises(ValueError): self.validate(value)

    def test_wrong_binding(self):
        raw=json.dumps(self.value).encode()
        for binding in ({'round':2,'protocolSha256':self.lock['protocolSha256'],'resultSha256':quality.sha(raw)}, {'round':1,'protocolSha256':'0'*64,'resultSha256':quality.sha(raw)}, {'round':1,'protocolSha256':self.lock['protocolSha256'],'resultSha256':'0'*64}):
            with self.assertRaises(ValueError): quality.validate_record(self.value,binding,raw,self.job,'webgpu',1,self.lock)

    def test_bad_axes_and_duplicate_jobs(self):
        protocol=quality.read(quality.REPORT/'protocol.json')
        jobs=quality.read(quality.REPORT/'jobs.json')
        quality.validate_protocol_jobs(protocol,jobs)
        jobs[-1]=jobs[0]
        with self.assertRaises(ValueError): quality.validate_protocol_jobs(protocol,jobs)
        protocol['rounds']=[1,1,3]
        with self.assertRaises(ValueError): quality.validate_protocol_jobs(protocol,quality.read(quality.REPORT/'jobs.json'))

    def test_iou_category_score_and_one_to_one(self):
        box={'image_id':1,'category_id':1,'bbox':[0,0,10,10],'score':.8}
        self.assertEqual(quality.parity([box],[box],[1],.5)['fraction'],1)
        for candidate in ({**box,'category_id':2},{**box,'bbox':[50,50,10,10]},{**box,'score':.49}):
            self.assertEqual(quality.parity([box],[candidate],[1],.5)['fraction'],0)
        self.assertEqual(quality.parity([box,box],[box],[1],.5)['fraction'],.5)

    def test_gate_boundaries(self):
        self.assertTrue(quality.quality_pass(-.5,.95))
        self.assertFalse(quality.quality_pass(-.5001,1))
        self.assertFalse(quality.quality_pass(0,.9499))

    def test_optimized_mode_rejects_actual_bad_record(self):
        code='from test_quality import EvidenceTests; EvidenceTests.setUpClass(); v=EvidenceTests.value; v["runtime"]["backend"]="wasm"; EvidenceTests().validate(v)'
        result=subprocess.run([sys.executable,'-O','-c',code],cwd=quality.REPORT,capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'ValueError',result.stderr)

if __name__ == '__main__': unittest.main()
