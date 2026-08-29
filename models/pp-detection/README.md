# PicoDet 模型资产

# PP-Detection 模型资产

本目录保存版本化 ONNX 产物和清单。PicoDet-L-320 当前已有一个本地 FP32 ONNX
候选，并通过 CPU ORT parity；候选的结构、哈希和 fixture 证据见
`1.0.0/README.md` 与 `tools/model-pipeline/reports/picodet-parity.json`。

本地候选已经记录到 Git LFS（默认）、Hugging Face 和 ModelScope 的不可变发布来源，
对应 revision、下载地址、大小和 SHA-256 见
`tools/model-pipeline/reports/picodet-source-evidence.json`。已有一次 Windows
HeadlessChrome 的 WASM/CPU smoke test，但 WebGPU、移动端和微信 WebView 仍未验证，
来源许可核验也未完成，所以默认清单仍为 `labs/blocked`。不要把候选分发副本的存在
误解为 stable 发布承诺。
