# 模型转换

[English](../en/conversion.md)

转换工具位于 `tools/model-pipeline`，要求 Python 3.11。它从 safetensors 导出 opset 18 FP32 ONNX，执行结构/数值/检测结果对齐，再生成 FP16 候选、验证变体并构建清单。不要手工修改 `manifest.json`。

```powershell
Set-Location tools/model-pipeline
python -m ppdetection.inspect_model
python -m ppdetection.export_fp32
python -m ppdetection.validate
python -m ppdetection.convert_fp16
python -m ppdetection.variant_validation
python -m ppdetection.build_manifest
```

具体参数与本地模型路径以各模块的 `--help` 为准。验证报告必须绑定源文件 SHA-256、ONNX SHA-256、opset、输入输出名称/形状、检测匹配和浏览器运行证据。只有通过验收的变体才能写入清单。

## 当前资产状态

当前仓库已有一个可复现的本地 PicoDet-L-320 FP32 ONNX 候选
`models/pp-detection/1.0.0/picodet-l-320-fp32.onnx`。结构检查得到
`23,219,047` 字节、`5,787,988` 参数和 opset 11；三张 fixture 的 CPU ORT
parity 均通过，完整哈希、预处理和误差见
`tools/model-pipeline/reports/picodet-parity.json`。

该候选尚未绑定 Git LFS、Hugging Face 或 ModelScope 的不可变来源。已有一次
Windows HeadlessChrome 的 WASM/CPU smoke test，证据见
`tools/model-pipeline/reports/picodet-browser-evidence.json`；本次 WebGPU 没有
可用 adapter，移动端、微信 WebView 和其他浏览器仍未验证。因此默认 manifest
仍为 `labs/blocked`，应用接入时请传入已验证的 runtime manifest。文档和清单不会
把本地候选伪装成 stable 发布资产。

完成官方权重导出后，按以下顺序为每个 FP32、FP16、INT8、INT4 或 FP8 变体生成证据：结构检查、CPU 数值/检测对齐、浏览器 WASM 与 WebGPU 验证、文件 SHA-256 和不可变来源校验，最后运行 `build_manifest`。只有证据完整且目标后端通过的变体才能标记为 `stable`。
