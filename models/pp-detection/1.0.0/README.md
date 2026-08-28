# PicoDet-L-320 模型资产

本目录包含一个由 PaddleDetection 官方后处理 ONNX 清理得到的 PicoDet-L-320
FP32 ONNX 候选：`picodet-l-320-fp32.onnx`。它与官方
`picodet_l_320_lcnet_postprocessed.onnx` 下载文件字节一致；官方 URL、文档
revision、字节数和 SHA-256 记录在
`tools/model-pipeline/reports/picodet-source-evidence.json`。候选文件的输入输出
契约和三张 fixture 的 CPU ORT parity 记录在
`tools/model-pipeline/reports/picodet-parity.json`。

该文件目前是可复现的本地候选，不代表已完成官方发布来源或完整浏览器兼容性验收。
已有一次 Windows HeadlessChrome 的 WASM/CPU smoke test，WebGPU 在该环境中没有
可用 adapter；详细限制见 `tools/model-pipeline/reports/picodet-browser-evidence.json`。
因此 `manifest.json` 继续保持 `labs/blocked`，SDK 默认不会把它当作稳定内置模型；
官方 URL 还没有可复用的不可变 revision，且三类分发副本尚未发布。
Git LFS、Hugging Face 和 ModelScope 的不可变 revision、下载地址、许可核验，以及
WASM/WebGPU 浏览器证据完成后，才能由构建脚本生成可发布变体。
