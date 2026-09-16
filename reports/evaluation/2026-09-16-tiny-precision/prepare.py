"""生成 PP-YOLO Tiny 的 FP16/W8A32 实验模型和 labs 清单。"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "reports/evaluation/2026-09-16-tiny-precision"
WORK = ROOT / ".tmp/tiny-precision"
SOURCE = ROOT / ".tmp/candidate-2d-20260915/ppyolo-tiny-320-fp32.onnx"
SOURCE_SHA = "1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653"
BASE_MANIFEST = ROOT / "models/ppyolo-tiny-320/0.1.0/manifest.json"

def digest(path: Path):
    data = path.read_bytes()
    return len(data), hashlib.sha256(data).hexdigest()

def inspect_model(path: Path):
    model = onnx.load(path)
    onnx.checker.check_model(model, full_check=True)
    inp = model.graph.input[0].type.tensor_type
    dims = [d.dim_value or -1 for d in inp.shape.dim]
    for tensor in model.graph.initializer:
        if tensor.data_type in (onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16):
            if not np.isfinite(onnx.numpy_helper.to_array(tensor)).all():
                raise ValueError(f"候选含非有限权重：{tensor.name}")
    return {"input": dims, "inputDtype": onnx.TensorProto.DataType.Name(inp.elem_type),
            "outputDtypes": [onnx.TensorProto.DataType.Name(x.type.tensor_type.elem_type) for x in model.graph.output],
            "opset": next(x.version for x in model.opset_import if x.domain == ""),
            "nodeCount": len(model.graph.node),
            "parameterCount": sum(int(np.prod(t.dims)) for t in model.graph.initializer)}

def manifest_for(base, precision, filename, size, sha, metadata):
    value = json.loads(json.dumps(base, ensure_ascii=False))
    value["status"] = "labs"
    value["defaultVariant"] = precision
    value["defaultSource"] = "custom"
    value["model"]["version"] = "0.1.1"
    value["model"]["assets"] = [{"filename": filename, "bytes": size, "sha256": sha}]
    value["variants"] = [{"id": precision, "precision": "int8" if precision == "w8a32" else precision,
        "quantization": "weight-only-int8-activation-fp32" if precision == "w8a32" else "mixed-fp16-sensitive-ops-fp32",
        "opset": metadata["opset"], "bytes": size, "sha256": sha,
        "parameterCount": metadata["parameterCount"], "status": "labs", "backends": ["wasm", "webgpu"],
        "sources": [{"kind": "custom", "repository": "local/tiny-precision-evaluation",
          "revision": sha, "path": filename, "downloadUrl": f"http://127.0.0.1:4173/{filename}",
          "bytes": size, "sha256": sha}]}]
    value["limitations"] = ["本变体只用于本轮固定 64 图桌面评测，未进入稳定模型目录。",
        "本地来源仅用于证据身份，不能据此宣称 Hub 已发布或移动端/NPU 兼容。"]
    return value

def main():
    if digest(SOURCE) != (4511117, SOURCE_SHA):
        raise ValueError("Tiny FP32 源摘要不匹配")
    REPORT.mkdir(parents=True, exist_ok=True); (REPORT / "manifests").mkdir(exist_ok=True); WORK.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(ROOT / "tools/model-pipeline"))
    import float16_models, weight_only
    specs = {
        "fp16": {"blockedNodes": ["Exp.0", "Exp.2", "Exp.4"], "excludeNodes": [],
                 "reason": "Tiny 三个尺度的 Exp 解码对坐标幅度敏感，保留为 FP32；节点名来自 Tiny 图。"},
        "w8a32": {"blockedNodes": [], "excludeNodes": ["Conv.0", "Conv.1", "Conv.2", "Conv.3", "Conv.4", "Conv.80", "Conv.81", "Conv.82"],
                  "reason": "Tiny 输入 stem 与末端三个检测头卷积保留 FP32，避免低层纹理和分类/回归输出量化误差。"},
    }
    generated=[]
    for precision, cfg in specs.items():
        output = WORK / f"ppyolo-tiny-320-{precision}.onnx"
        conversion = REPORT / "conversions" / f"ppyolo-tiny-320-{precision}.conversion.json"
        output.unlink(missing_ok=True); conversion.unlink(missing_ok=True)
        if precision == "fp16":
            result = float16_models.convert(SOURCE, output, expected_sha256=SOURCE_SHA, blocked_nodes=tuple(cfg["blockedNodes"]))
        else:
            result = weight_only.convert(SOURCE, output, expected_sha256=SOURCE_SHA, exclude_nodes=tuple(cfg["excludeNodes"]))
        size, sha = digest(output); metadata = inspect_model(output)
        conversion.parent.mkdir(exist_ok=True)
        conversion.write_text(json.dumps({"key":"ppyolo-tiny-320", "precision":precision, "sourceModel":str(SOURCE.relative_to(ROOT)).replace("\\","/"), "sourceBytes":4511117, "sourceSha256":SOURCE_SHA, "configuration":cfg, "candidate":result, "validation":metadata}, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        manifest = manifest_for(json.loads(BASE_MANIFEST.read_text(encoding="utf-8")), precision, output.name, size, sha, metadata)
        manifest_path = REPORT / "manifests" / f"ppyolo-tiny-320-{precision}.manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        generated.append({"key":"ppyolo-tiny-320", "precision":precision, "model":str(output.relative_to(ROOT)).replace("\\","/"), "manifest":str(manifest_path.relative_to(ROOT)).replace("\\","/"), "bytes":size, "sha256":sha, "inputSize":320, "sourceModel":str(SOURCE.relative_to(ROOT)).replace("\\","/"), "sourceBytes":4511117, "sourceSha256":SOURCE_SHA})
    generated.append({"key":"ppyolo-tiny-320", "precision":"fp32", "model":str(SOURCE.relative_to(ROOT)).replace("\\","/"), "manifest":"models/ppyolo-tiny-320/0.1.0/manifest.json", "bytes":4511117, "sha256":SOURCE_SHA, "inputSize":320, "sourceModel":str(SOURCE.relative_to(ROOT)).replace("\\","/"), "sourceBytes":4511117, "sourceSha256":SOURCE_SHA})
    generated.sort(key=lambda x: (x["key"], ("fp32","fp16","w8a32").index(x["precision"])))
    (REPORT / "jobs.json").write_text(json.dumps(generated, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    sample=np.zeros((1,3,320,320),dtype=np.float32); cpu=[]
    for job in generated:
        session=ort.InferenceSession(str(ROOT/job["model"]),providers=["CPUExecutionProvider"]); outputs=session.run(None,{"image":sample})
        cpu.append({"precision":job["precision"],"modelSha256":job["sha256"],"provider":session.get_providers(),"outputs":[{"shape":list(x.shape),"dtype":str(x.dtype),"finite":bool(np.isfinite(x).all())} for x in outputs]})
    (REPORT/"cpu-validation.json").write_text(json.dumps({"input":{"shape":[1,3,320,320],"dtype":"float32","fixture":"all-zero"},"runs":cpu},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (REPORT / "labs.json").write_text(json.dumps({"model":"ppyolo-tiny-320", "sourceSha256":SOURCE_SHA, "candidates":[{"precision":p, "configuration":specs[p]} for p in specs]}, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"jobs":len(generated), "candidates":2, "sizes":{j["precision"]:j["bytes"] for j in generated}}, ensure_ascii=False))

if __name__ == "__main__": main()
