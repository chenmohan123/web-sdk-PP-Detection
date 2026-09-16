import importlib.util, json
from pathlib import Path

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location("prepare", HERE/"prepare.py")
prepare=importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)

def test_labs_manifest_uses_local_identity():
    base=json.loads(prepare.BASE_MANIFEST.read_text(encoding="utf-8"))
    value=prepare.manifest_for(base,"fp16","x.onnx",123,"a"*64,{"opset":14,"parameterCount":1})
    assert value["status"] == "labs" and value["model"]["version"] == "0.1.1"
    assert value["variants"][0]["sources"][0]["kind"] == "custom"
    assert value["variants"][0]["sha256"] == "a"*64

def test_tiny_sensitive_nodes_exist_and_are_not_picodet_names():
    import onnx
    names={n.name for n in onnx.load(prepare.SOURCE).graph.node}
    assert {"Exp.0","Exp.2","Exp.4","Conv.80","Conv.81","Conv.82"} <= names
    assert "Cast_5" not in names
