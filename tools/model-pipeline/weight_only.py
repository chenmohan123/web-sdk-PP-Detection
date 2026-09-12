"""将卷积权重保存为 INT8；激活和卷积计算保持 FP32。"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import tempfile
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper


def quantize_model(source: onnx.ModelProto, *, exclude_nodes=()):
    model = onnx.ModelProto()
    model.CopyFrom(source)
    if next(x.version for x in model.opset_import if x.domain == '') < 13:
        raise ValueError('按通道权重解量化要求 opset >= 13')
    excluded = set(exclude_nodes)
    names = {n.name for n in model.graph.node}
    if excluded - names:
        raise ValueError('排除节点不存在：' + ', '.join(sorted(excluded - names)))
    weights = {x.name: x for x in model.graph.initializer}
    for name, tensor in weights.items():
        values = numpy_helper.to_array(tensor)
        if np.issubdtype(values.dtype, np.floating) and not np.isfinite(values).all():
            raise ValueError('权重必须为有限数值：' + name)
    selected = [n for n in model.graph.node if n.op_type == 'Conv' and n.name not in excluded]
    consumers = collections.defaultdict(list)
    for node in model.graph.node:
        for index, name in enumerate(node.input):
            consumers[name].append((node.name, node.op_type, index))
    occupied = names | set(weights) | {v for n in model.graph.node for v in [*n.input, *n.output]}
    protected = {x.name for x in [*model.graph.input, *model.graph.output]}
    nodes, quantized, errors, skipped = [], set(), [], []
    eligible = set()
    for node in selected:
        name = node.input[1]
        if name not in weights or name in protected:
            skipped.append(name)
            continue
        if any(kind != 'Conv' or index != 1 or consumer in excluded for consumer, kind, index in consumers[name]):
            skipped.append(name)
            continue
        eligible.add(name)
    for node in model.graph.node:
        if node.op_type == 'Conv' and node.input[1] in eligible:
            name = node.input[1]
            if name not in quantized:
                weight = numpy_helper.to_array(weights[name])
                if weight.dtype != np.float32 or weight.ndim < 3 or not weight.size:
                    raise ValueError('仅支持非空 FP32 卷积权重：' + name)
                generated = [name + '_w8', name + '_w8_scale', name + '_w8_zero', name + '_W8A32_Dequantize']
                if occupied.intersection(generated):
                    raise ValueError('生成张量名称冲突：' + name)
                occupied.update(generated)
                maximum = np.max(np.abs(weight), axis=tuple(range(1, weight.ndim)))
                scale = np.maximum(maximum / 127, np.finfo(np.float32).tiny).astype(np.float32)
                view = scale.reshape((-1,) + (1,) * (weight.ndim - 1))
                quant = np.clip(np.rint(weight / view), -127, 127).astype(np.int8)
                model.graph.initializer.extend([
                    numpy_helper.from_array(quant, generated[0]),
                    numpy_helper.from_array(scale, generated[1]),
                    numpy_helper.from_array(np.zeros(scale.shape, dtype=np.int8), generated[2]),
                ])
                nodes.append(helper.make_node('DequantizeLinear', generated[:3], [name], name=generated[3], axis=0))
                quantized.add(name)
                errors.append({'weight': name, 'maxAbsError': float(np.max(np.abs(weight - quant.astype(np.float32) * view)))})
        nodes.append(node)
    keep = [x for x in model.graph.initializer if x.name not in quantized]
    model.graph.ClearField('initializer')
    model.graph.initializer.extend(keep)
    model.graph.ClearField('node')
    model.graph.node.extend(nodes)
    onnx.checker.check_model(model, full_check=True)
    return model, {'quantizedWeightTensors': len(quantized), 'excludedNodes': sorted(excluded), 'skippedSharedOrDynamicWeights': sorted(set(skipped)), 'weightErrors': errors}


def describe(path):
    data = Path(path).read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def convert(source, output, *, expected_sha256, exclude_nodes=(), prepare=True):
    import onnxruntime as ort
    from onnxruntime.quantization.shape_inference import quant_pre_process

    source, output = Path(source), Path(output)
    if output.exists():
        raise FileExistsError(output)
    original = describe(source)
    if original['sha256'] != expected_sha256.lower():
        raise ValueError('源模型 SHA-256 不匹配')
    onnx.checker.check_model(str(source), full_check=True)
    with tempfile.TemporaryDirectory(prefix='detection-w8a32-') as temporary:
        temporary = Path(temporary)
        model = onnx.load(source)
        if prepare:
            version = next(x.version for x in model.opset_import if x.domain == '')
            if version < 13:
                model = onnx.version_converter.convert_version(model, 13)
            converted = temporary / 'opset13.onnx'
            prepared = temporary / 'prepared.onnx'
            onnx.save(model, converted)
            quant_pre_process(converted, prepared, skip_symbolic_shape=True)
            model = onnx.load(prepared)
        candidate, details = quantize_model(model, exclude_nodes=exclude_nodes)
        if details['quantizedWeightTensors'] == 0:
            raise ValueError('没有可压缩的卷积权重')
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('xb') as stream:
            stream.write(candidate.SerializeToString())
    return {
        'status': 'labs', 'quantization': 'weight-only-int8-activation-fp32',
        'activationPrecision': 'fp32', 'floatingInputOutputPrecision': 'fp32',
        'source': original, 'output': describe(output), 'prepared': prepare,
        'versions': {'onnx': onnx.__version__, 'onnxruntime': ort.__version__, 'numpy': np.__version__},
        'opsets': {x.domain: x.version for x in candidate.opset_import},
        'operators': dict(collections.Counter(n.op_type for n in candidate.graph.node)),
        'fullOnnxCheck': True, **details,
    }


def main():
    parser = argparse.ArgumentParser(description='生成 W8A32 卷积权重压缩实验模型，激活保持 FP32')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--exclude-node', action='append', default=[])
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists():
        raise FileExistsError(args.report)
    report = convert(args.input, args.output, expected_sha256=args.sha256, exclude_nodes=args.exclude_node)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': report['status'], **report['output']}))


if __name__ == '__main__':
    main()
