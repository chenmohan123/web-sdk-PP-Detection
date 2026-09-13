"""复现本次 SOD L 640 的两处 NMS 轴修正及单输入导出约束。"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
import onnx
from onnx import helper, numpy_helper


def prepare(source: Path, output: Path, report: Path):
    expected = json.loads((Path(__file__).resolve().parents[1] / "raw-inspection.json").read_text(encoding="utf-8"))["sha256"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        raise ValueError("原始 ONNX 摘要与本次评测对象不一致，拒绝修改未知图")
    model = onnx.load(source)
    assert [(v.domain, v.version) for v in model.opset_import] == [("", 11)]
    nodes = {n.name: n for n in model.graph.node if n.name}
    assert len(nodes) == sum(bool(n.name) for n in model.graph.node)
    nms = nodes["NonMaxSuppression.0"]
    assert nms.op_type == "NonMaxSuppression" and list(nms.output) == ["nms.selected_index.0"]
    constants = {n.output[0]: numpy_helper.to_array(next(a.t for a in n.attribute if a.name == "value")) for n in model.graph.node if n.op_type == "Constant"}
    changes = []
    for gather_name, column, squeeze_name, downstream in [("Gather.0", 1, "Squeeze.4", "Gather.8"), ("Gather.2", 2, "Squeeze.6", "Gather.10")]:
        gather = nodes[gather_name]
        assert gather.op_type == "Gather" and gather.input[0] == nms.output[0]
        assert [(a.name, helper.get_attribute_value(a)) for a in gather.attribute] == [("axis", 1)]
        assert constants[gather.input[1]].tolist() == [column]
        squeeze = nodes[squeeze_name]
        assert squeeze.op_type == "Squeeze" and list(squeeze.input) == list(gather.output) and not squeeze.attribute
        assert nodes[downstream].op_type == "Gather" and nodes[downstream].input[0] == squeeze.output[0]
        squeeze.attribute.append(helper.make_attribute("axes", [1]))
        changes.append(f"{squeeze_name}.axes=[1]")
    inputs = {v.name: v for v in model.graph.input}
    assert set(inputs) == {"image", "scale_factor"}
    assert inputs["image"].type.tensor_type.elem_type == onnx.TensorProto.FLOAT
    assert [d.dim_value for d in inputs["image"].type.tensor_type.shape.dim[1:]] == [3, 640, 640]
    assert inputs["scale_factor"].type.tensor_type.elem_type == onnx.TensorProto.FLOAT
    assert [d.dim_value for d in inputs["scale_factor"].type.tensor_type.shape.dim[1:]] == [2]
    batch = inputs["image"].type.tensor_type.shape.dim[0]
    batch.ClearField("dim_param")
    batch.dim_value = 1
    model.graph.input.remove(inputs["scale_factor"])
    assert not any(v.name == "scale_factor" for v in model.graph.initializer)
    model.graph.initializer.append(numpy_helper.from_array(np.ones((1, 2), dtype=np.float32), name="scale_factor"))
    changes.extend(["image_batch=1", "scale_factor=initializer[[1,1]]"])
    onnx.checker.check_model(model)
    output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, output)
    report.write_text(json.dumps({"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "outputSha256": hashlib.sha256(output.read_bytes()).hexdigest(), "changes": changes}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("input", "output", "report"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.input, args.output, args.report)
