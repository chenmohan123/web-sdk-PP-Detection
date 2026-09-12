"""FP16 转换器的行为测试。"""
import hashlib
import numpy as np
import onnx
import onnxruntime as ort
import pytest
from onnx import TensorProto, helper, numpy_helper
from float16_models import convert_graph, convert


def sample():
    nodes=[helper.make_node('Mul',['x','w'],['h'],name='multiply'),helper.make_node('ReduceMean',['h'],['y'],name='mean',axes=[1],keepdims=1)]
    graph=helper.make_graph(nodes,'mean',[helper.make_tensor_value_info('x',TensorProto.FLOAT,[1,70000])],[helper.make_tensor_value_info('y',TensorProto.FLOAT,[1,1])],[numpy_helper.from_array(np.ones([1],dtype=np.float32),'w')])
    return helper.make_model(graph,opset_imports=[helper.make_opsetid('',11)],ir_version=7)


def test_fp32_reduction_boundary_preserves_io_and_source():
    original=sample();before=original.SerializeToString()
    candidate=convert_graph(original,extra_blocked_ops=['ReduceMean'])
    assert original.SerializeToString()==before
    types={v.name:v.type.tensor_type.elem_type for v in [*candidate.graph.input,*candidate.graph.output,*candidate.graph.value_info]}
    mean=next(n for n in candidate.graph.node if n.op_type=='ReduceMean')
    assert types[mean.input[0]]==TensorProto.FLOAT
    assert candidate.graph.input[0].type.tensor_type.elem_type==TensorProto.FLOAT
    assert candidate.graph.output[0].type.tensor_type.elem_type==TensorProto.FLOAT
    result=ort.InferenceSession(candidate.SerializeToString(),providers=['CPUExecutionProvider']).run(None,{'x':np.ones([1,70000],np.float32)})[0]
    np.testing.assert_allclose(result,[[1]],atol=0,rtol=0)


def test_nonfinite_source_rejected():
    original=sample();original.graph.initializer[0].CopyFrom(numpy_helper.from_array(np.array([np.inf],np.float32),'w'))
    with pytest.raises(ValueError,match='有限'):convert_graph(original)


def test_unknown_blocked_node_rejected():
    with pytest.raises(ValueError,match='不存在'):convert_graph(sample(),blocked_nodes=['missing'])


def test_conversion_guards_digest_and_existing_output(tmp_path):
    source=tmp_path/'source.onnx';target=tmp_path/'fp16.onnx';onnx.save(sample(),source)
    with pytest.raises(ValueError,match='SHA-256'):convert(source,target,expected_sha256='0'*64)
    assert not target.exists()
    expected=hashlib.sha256(source.read_bytes()).hexdigest()
    report=convert(source,target,expected_sha256=expected,extra_blocked_ops=['ReduceMean'])
    original=target.read_bytes();assert report['candidateSha256']==hashlib.sha256(original).hexdigest()
    with pytest.raises(FileExistsError):convert(source,target,expected_sha256=expected)
    assert target.read_bytes()==original
