"""可行性脚本：固定官方 Tiny 320 配置，导出 Paddle 和原始 FP32 ONNX。"""
import argparse
import hashlib
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
args = parser.parse_args()
report = Path(__file__).resolve().parents[1]
lock = json.loads((report / 'sources.lock.json').read_text(encoding='utf-8'))
upstream = args.cache.resolve() / ('upstream/PaddleDetection-' + lock['upstreamRevision'])
work = args.work.resolve()
for item in lock['files']:
    content = (upstream / item['path']).read_bytes()
    if len(content) != item['bytes'] or hashlib.sha256(content).hexdigest() != item['sha256']:
        raise ValueError(f'源码摘要不匹配：{item["path"]}')
weight = work / 'ppyolo_tiny_650e_coco.pdparams'
if hashlib.sha256(weight.read_bytes()).hexdigest() != lock['weights']['sha256']:
    raise ValueError('权重摘要不匹配')
os.environ['MPLCONFIGDIR'] = str(work / 'matplotlib')
import paddle.jit.dy2static.utils as translator_utils


def local_temp_dir():
    location = work / 'paddle-cache' / str(os.getpid())
    location.mkdir(parents=True, exist_ok=True)
    return str(location)


translator_utils.get_temp_dir = local_temp_dir
sys.path.insert(0, str(upstream))
os.chdir(upstream)
sys.argv = [str(upstream / 'tools/export_model.py'), '-c', 'configs/ppyolo/ppyolo_tiny_650e_coco.yml',
            '-o', 'use_gpu=False', f'weights={weight}', 'TestReader.inputs_def.image_shape=[3,320,320]',
            'export_onnx=True', '--output_dir', str(work / 'exported')]
print(json.dumps(sys.argv), flush=True)
runpy.run_path(sys.argv[0], run_name='__main__')
command = [str(Path(sys.executable).parent / 'paddle2onnx.exe'), '--model_dir',
           str(work / 'exported/ppyolo_tiny_650e_coco'), '--model_filename', 'model.pdmodel',
           '--params_filename', 'model.pdiparams', '--opset_version', '11', '--save_file', str(work / 'tiny-raw.onnx')]
print(json.dumps(command), flush=True)
subprocess.run(command, check=True)
