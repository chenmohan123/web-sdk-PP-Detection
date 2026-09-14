"""精度评测缓存必须绑定配置和完整输出。"""
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[3] / 'reports/evaluation/2026-09-14-ppyoloe-mlx-precision/evaluate.py'
SPEC = importlib.util.spec_from_file_location('mlx_evaluation', SCRIPT)
EVALUATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATION)


def test_python_evidence_rejects_changed_predictions_runtime_and_inputs(tmp_path):
    runtime = tmp_path / 'runtime.json'
    predictions = tmp_path / 'predictions.json'
    runtime.write_text('{"modelSha256":"source"}', encoding='utf-8')
    predictions.write_text('[]', encoding='utf-8')
    identity = {'modelSha256': 'source', 'annotationsSha256': 'dataset', 'imageSetSha256': 'images',
                'inferenceScriptSha256': 'script', 'preprocessing': 'opencv', 'threads': 4,
                'runtimeVersions': {'python': '3.11.15', 'onnxruntime': '1.20.1', 'opencv': '4.11.0', 'numpy': '1.26.4'}}
    binding = EVALUATION.bind_python(identity, runtime, predictions)
    EVALUATION.verify_python(binding, identity, runtime.read_bytes(), predictions.read_bytes())
    with pytest.raises(ValueError, match='预测'):
        EVALUATION.verify_python(binding, identity, runtime.read_bytes(), b'[{}]')
    with pytest.raises(ValueError, match='运行报告'):
        EVALUATION.verify_python(binding, identity, b'{}', predictions.read_bytes())
    with pytest.raises(ValueError, match='输入或配置'):
        EVALUATION.verify_python(binding, {**identity, 'imageSetSha256': 'other'}, runtime.read_bytes(), predictions.read_bytes())

    with pytest.raises(ValueError, match='输入或配置'):
        EVALUATION.verify_python(binding, {**identity, 'runtimeVersions': {'onnxruntime': 'changed'}}, runtime.read_bytes(), predictions.read_bytes())
