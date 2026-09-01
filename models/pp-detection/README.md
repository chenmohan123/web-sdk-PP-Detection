# PicoDet 模型资产

# PP-Detection 模型资产

本目录保存当前 ONNX 产物和清单，更新时直接替换根目录文件。PicoDet-L-320 当前已有一个本地 FP32 ONNX
候选，并通过 CPU ORT parity；候选的结构、哈希和 fixture 证据见
`manifest.json` 与 `tools/model-pipeline/reports/picodet-parity.json`。

本地候选已经记录到 Git LFS（默认）、Hugging Face 和 ModelScope 的不可变发布来源，
对应 revision、下载地址、大小和 SHA-256 见
`tools/model-pipeline/reports/picodet-source-evidence.json`。已有一次 Windows
HeadlessChrome 的 WASM/CPU smoke test，但 WebGPU、移动端和微信 WebView 仍未验证，
来源许可核验、非 FP32 变体等限制以 `manifest.json` 和对应报告为准；历史报告是验证证据，不是当前模型目录。
