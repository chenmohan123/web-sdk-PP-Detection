"""验证发布入口拒绝在完整复算后改动质量或身份文件。"""
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import publish


class PublicationTests(unittest.TestCase):
    def test_current_selection_excludes_failed_xs_quantization(self):
        accepted, _, _ = publish.selected()
        self.assertEqual(len(accepted), 14)
        self.assertFalse(any(j['key'].startswith('picodet-xs-') and j['precision']=='w8a32' for j in accepted))

    def test_modified_summary_cannot_promote_failed_candidate(self):
        target=publish.REPORT/'summary.json'
        data=publish.read(target)
        for row in data['rows']:
            if row['key']=='picodet-xs-320' and row['precision']=='w8a32':
                row['retention']['fraction']=.96
        next(x for x in data['candidates'] if x['key']=='picodet-xs-320' and x['precision']=='w8a32')['qualityGatePassed']=True
        actual_read=Path.read_bytes
        def altered(path):
            return json.dumps(data).encode() if path==target else actual_read(path)
        with patch.object(Path,'read_bytes',altered):
            with self.assertRaisesRegex(ValueError,'复算后证据发生变化'):
                publish.selected()

    def test_modified_archive_or_jobs_is_rejected(self):
        for name in ('jobs.json','evidence/round-1/picodet-xs-320-fp32-webgpu.json.gz'):
            with self.subTest(name=name):
                target=publish.REPORT/name
                actual_read=Path.read_bytes
                def altered(path):
                    data=actual_read(path)
                    return data+b' ' if path==target else data
                with patch.object(Path,'read_bytes',altered):
                    with self.assertRaisesRegex(ValueError,'复算后证据发生变化'):
                        publish.selected()

    def test_published_job_cannot_replace_verified_weights(self):
        accepted=publish.read(publish.REPORT/'accepted-jobs.json')
        jobs=[{**j,'manifest':f'models/pp-detection/{j["key"]}/1.0.1/manifest.json'} for j in accepted]
        publish.validate_published_jobs(jobs,accepted)
        for field in ('bytes','sha256','model','manifest'):
            with self.subTest(field=field):
                changed=[dict(x) for x in jobs]
                changed[0][field]='被替换'
                with self.assertRaisesRegex(ValueError,'三轮验收身份不一致'):
                    publish.validate_published_jobs(changed,accepted)


if __name__=='__main__': unittest.main()
