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

当前仓库已有一个可复现的 PicoDet-L-320 FP32 ONNX stable 产物
`models/pp-detection/picodet-l-320-fp32.onnx`。结构检查得到
`23,243,834` 字节、`5,787,988` 参数和 opset 11；七张 fixture 的 CPU ORT
parity 均通过，完整哈希、预处理和误差见
`tools/model-pipeline/reports/picodet-parity.json`。

该 stable 产物已经记录到 Git LFS、Hugging Face 和 ModelScope 的不可变来源，三类来源的
revision、下载地址、大小和 SHA-256 见
`tools/model-pipeline/reports/picodet-source-evidence.json`。已有一次 Windows
HeadlessChrome 的 WASM/CPU smoke test，证据见
`tools/model-pipeline/reports/picodet-browser-evidence.json`；本次 WebGPU 没有
可用 adapter，移动端、微信 WebView 和其他浏览器仍未验证，来源许可核验也未完成。
以上内容是 1.0.1 FP32 的历史生成证据。当前 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 已发布 FP32、FP16、W8A32 六个 stable 变体；FP16/W8A32 的证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图，移动端和微信 WebView 仍需独立验证。

完成官方权重导出后，按以下顺序为每个 FP32、FP16、INT8、INT4 或 FP8 变体生成证据：结构检查、CPU 数值/检测对齐、浏览器 WASM 与 WebGPU 验证、文件 SHA-256 和不可变来源校验，最后运行 `build_manifest`。只有证据完整且目标后端通过的变体才能标记为 `stable`。

## 第二模型历史评测

PP-YOLOE+ S 的实际转换入口位于 `tools/model-pipeline/ppyoloe/`，使用固定的官方 PaddleDetection 源码、Paddle 导出与 Paddle2ONNX opset 11。0.1.0 的来源、COCO 子集、原 Paddle 与 ONNX 对齐和浏览器结果见[2026-09-11 报告](../../reports/evaluation/2026-09-11-ppyoloe/README.md)；当前 0.1.1 三精度结果见[2026-09-12 报告](../../reports/evaluation/2026-09-12-precision-variants/README.md)。
