from pathlib import Path
import hashlib
import numpy as np
import onnx
import onnxruntime as ort
import pytest
from onnx import helper, numpy_helper, TensorProto
from weight_only import quantize_model, convert

def model(shared=False, zero=False):
    w=np.zeros((2,1,1,1),np.float32) if zero else np.array([.137,3.5],np.float32).reshape(2,1,1,1)
    nodes=[helper.make_node('Conv',['x','w'],['y'],name='first')]
    outputs=[helper.make_tensor_value_info('y',TensorProto.FLOAT,[1,2,2,2])]
    if shared:
        nodes.append(helper.make_node('Conv',['x','w'],['z'],name='second'));outputs.append(helper.make_tensor_value_info('z',TensorProto.FLOAT,[1,2,2,2]))
    return helper.make_model(helper.make_graph(nodes,'test',[helper.make_tensor_value_info('x',TensorProto.FLOAT,[1,1,2,2])],outputs,[numpy_helper.from_array(w,'w')]),opset_imports=[helper.make_opsetid('',13)],ir_version=7)

def test_roundtrip_runs_with_fp32_io_and_shared_weight():
    source=model(shared=True);before=source.SerializeToString();q,r=quantize_model(source)
    assert source.SerializeToString()==before
    assert sum(n.op_type=='DequantizeLinear' for n in q.graph.node)==1
    x=np.arange(4,dtype=np.float32).reshape(1,1,2,2)
    expected=ort.InferenceSession(before,providers=['CPUExecutionProvider']).run(None,{'x':x})
    actual=ort.InferenceSession(q.SerializeToString(),providers=['CPUExecutionProvider']).run(None,{'x':x})
    for a,b in zip(actual,expected):np.testing.assert_allclose(a,b,atol=.05)
    assert r['quantizedWeightTensors']==1

def test_zero_channel_stays_finite_and_zero():
    q,_=quantize_model(model(zero=True))
    values=ort.InferenceSession(q.SerializeToString(),providers=['CPUExecutionProvider']).run(None,{'x':np.ones((1,1,2,2),np.float32)})
    assert np.isfinite(values[0]).all();assert not values[0].any()

def test_excluded_shared_consumer_preserves_weight():
    q,r=quantize_model(model(shared=True),exclude_nodes=['first'])
    assert r['quantizedWeightTensors']==0
    assert [n.op_type for n in q.graph.node]==['Conv','Conv']

def test_nonfinite_rejected():
    m=model();m.graph.initializer[0].CopyFrom(numpy_helper.from_array(np.array([np.nan,1],np.float32).reshape(2,1,1,1),'w'))
    with pytest.raises(ValueError,match='有限'):quantize_model(m)

def test_exclusion_typo_rejected():
    with pytest.raises(ValueError,match='不存在'):quantize_model(model(),exclude_nodes=['typo'])

def test_name_collision_rejected():
    m=model();m.graph.initializer.append(numpy_helper.from_array(np.ones(1,np.float32),'w_w8'))
    with pytest.raises(ValueError,match='名称冲突'):quantize_model(m)

def test_input_digest_and_no_overwrite(tmp_path):
    source=tmp_path/'source.onnx';onnx.save(model(),source);target=tmp_path/'candidate.onnx'
    with pytest.raises(ValueError,match='SHA-256'):convert(source,target,expected_sha256='0'*64)
    assert not target.exists()
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    r=convert(source,target,expected_sha256=digest,prepare=False)
    assert r['status']=='labs';assert r['output']['sha256']==hashlib.sha256(target.read_bytes()).hexdigest()
    before=target.read_bytes()
    with pytest.raises(FileExistsError):convert(source,target,expected_sha256=digest,prepare=False)
    assert target.read_bytes()==before
