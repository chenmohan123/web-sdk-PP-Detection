"""复现 PP-YOLOE FP16 实验；仅在独立目录生成候选，不更新稳定清单。"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.transformers.float16 import DEFAULT_OP_BLOCK_LIST, convert_float_to_float16
from onnxruntime.transformers.onnx_model import OnnxModel

SOURCE_SHA256 = 'd3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c'


def tensors(graph):
    yield from graph.initializer
    for node in graph.node:
        for attribute in node.attribute:
            if attribute.type == onnx.AttributeProto.TENSOR:
                yield attribute.t
            elif attribute.type == onnx.AttributeProto.TENSORS:
                yield from attribute.tensors
            elif attribute.type == onnx.AttributeProto.GRAPH:
                yield from tensors(attribute.g)
            elif attribute.type == onnx.AttributeProto.GRAPHS:
                for child in attribute.graphs:
                    yield from tensors(child)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--keep-reduce-fp32', action='store_true')
    args = parser.parse_args()
    source_sha = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if source_sha != SOURCE_SHA256:
        raise ValueError('源模型 SHA-256 与稳定 PP-YOLOE FP32 不一致')
    if args.source.resolve() == args.output.resolve() or args.output.exists():
        raise ValueError('候选输出必须是独立的新文件，不能覆盖已有模型')
    additional_blocks = ['ReduceMean'] if args.keep_reduce_fp32 else []
    blocks = [*DEFAULT_OP_BLOCK_LIST, *additional_blocks]
    model = convert_float_to_float16(onnx.load(str(args.source)), keep_io_types=True, op_block_list=blocks)
    # 转换器追加 Cast；保存前只调整拓扑顺序，不修改运算语义。
    OnnxModel(model).topological_sort()
    onnx.checker.check_model(model, full_check=True)
    dtypes = Counter()
    for tensor in tensors(model.graph):
        array = onnx.numpy_helper.to_array(tensor)
        dtypes[onnx.TensorProto.DataType.Name(tensor.data_type)] += 1
        if np.issubdtype(array.dtype, np.floating) and not np.isfinite(array).all():
            raise ValueError(f'转换后权重/常量包含非有限数值：{tensor.name}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(args.output))
    report = {
        'sourceSha256': source_sha,
        'sourceBytes': args.source.stat().st_size,
        'candidateSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
        'candidateBytes': args.output.stat().st_size,
        'converter': 'onnxruntime.transformers.float16.convert_float_to_float16',
        'onnx': onnx.__version__, 'onnxruntime': ort.__version__, 'numpy': np.__version__,
        'keepIoTypes': True, 'opBlockList': blocks, 'additionalOpBlockList': additional_blocks,
        'checker': 'passed', 'finiteStoredTensors': True,
        'storedTensorDtypes': dict(dtypes),
        'tensorCountScope': '所有 initializer 和节点属性 TensorProto，不代表独立参数数量',
    }
    args.output.with_suffix('.conversion.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
