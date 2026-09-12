"""生成可重复的混合 FP16 模型，保留敏感算子与浮点输入输出边界。"""
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

PROFILES = {
    'picodet': ('0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1', (), ('Cast_5',)),
    'ppyoloe': ('d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c', ('ReduceMean',), ()),
}


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


def validate_finite(model):
    for tensor in tensors(model.graph):
        value = onnx.numpy_helper.to_array(tensor)
        if np.issubdtype(value.dtype, np.floating) and not np.isfinite(value).all():
            raise ValueError('权重与常量必须是有限数值：' + tensor.name)


def convert_graph(source, *, extra_blocked_ops=(), blocked_nodes=()):
    missing = set(blocked_nodes) - {node.name for node in source.graph.node}
    if missing:
        raise ValueError('保留节点不存在：' + ', '.join(sorted(missing)))
    validate_finite(source)
    model = onnx.ModelProto()
    model.CopyFrom(source)
    blocks = list(dict.fromkeys([*DEFAULT_OP_BLOCK_LIST, *extra_blocked_ops]))
    converted = convert_float_to_float16(
        model, keep_io_types=True, op_block_list=blocks, node_block_list=list(blocked_nodes)
    )
    # 转换器追加 Cast；重新排序只修复拓扑顺序，不改变计算语义。
    OnnxModel(converted).topological_sort()
    onnx.checker.check_model(converted, full_check=True)
    validate_finite(converted)
    for before, after in zip([*source.graph.input, *source.graph.output],
                             [*converted.graph.input, *converted.graph.output]):
        if before.type.tensor_type.elem_type != after.type.tensor_type.elem_type:
            raise ValueError('转换改变了输入输出的数据类型')
    return converted


def convert(source, output, *, expected_sha256, extra_blocked_ops=(), blocked_nodes=()):
    source, output = Path(source), Path(output)
    if output.exists():
        raise FileExistsError(output)
    original = source.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    if digest != expected_sha256.lower():
        raise ValueError('源模型 SHA-256 不匹配')
    candidate = convert_graph(onnx.load(source), extra_blocked_ops=extra_blocked_ops,
                              blocked_nodes=blocked_nodes)
    data = candidate.SerializeToString()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream:
        stream.write(data)
    return {
        'sourceSha256': digest, 'sourceBytes': len(original),
        'candidateSha256': hashlib.sha256(data).hexdigest(), 'candidateBytes': len(data),
        'converter': 'onnxruntime.transformers.float16.convert_float_to_float16',
        'versions': {'onnx': onnx.__version__, 'onnxruntime': ort.__version__, 'numpy': np.__version__},
        'opBlockList': list(dict.fromkeys([*DEFAULT_OP_BLOCK_LIST, *extra_blocked_ops])),
        'nodeBlockList': list(blocked_nodes), 'keepIoTypes': True,
        'fullOnnxCheck': True, 'finiteStoredTensors': True,
        'storedTensorDtypes': dict(Counter(onnx.TensorProto.DataType.Name(t.data_type)
                                          for t in tensors(candidate.graph))),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=PROFILES, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report_path = args.output.with_suffix('.conversion.json')
    if report_path.exists():
        raise FileExistsError(report_path)
    sha, ops, nodes = PROFILES[args.profile]
    report = convert(args.source, args.output, expected_sha256=sha,
                     extra_blocked_ops=ops, blocked_nodes=nodes)
    with report_path.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
