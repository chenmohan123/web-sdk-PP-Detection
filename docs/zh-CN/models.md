# 模型与精度

[English](../en/models.md)

当前仓库的 PicoDet-L-320 清单为 `models/pp-detection/1.0.1/manifest.json`，FP32
变体状态为 `stable`。该版本的 ONNX 文件已完成 CPU ORT parity；PaddleDetection
官方参考下载的字节数和 SHA-256 已核验，Git LFS、Hugging Face、ModelScope 三类
不可变分发来源也已记录 revision、下载地址、大小和 SHA-256；1.0.1 FP32 已在 Linux
WASM 和 Windows NVIDIA WebGPU 上完成 7 张 fixture 验证，并作为 SDK 默认加载的 stable
变体。FP16、移动端、微信 WebView 及量化版本不属于本次稳定兼容承诺。

| 变体            | 状态         | 说明                                                      |
| --------------- | ------------ | --------------------------------------------------------- |
| FP32            | stable       | 1.0.1；WASM 和 NVIDIA WebGPU 七张 fixture 通过            |
| FP16            | labs/blocked | 需要重新完成 CPU/WebGPU 精度、大小、内存和浏览器证据      |
| INT8、INT4、FP8 | labs         | 只有在精度、大小、内存和目标后端验证完成后才能标记 stable |

manifest 中的 `precision` 区分 `fp32`、`fp16`、`int8`、`int4` 和 `fp8`，`quantization` 记录量化方法（例如 static-qdq）。SDK 只会选择清单中声明为 stable 且与后端匹配的变体；手动选择未验证组合会返回 `MODEL_INCOMPATIBLE` 或 `CAPABILITY_UNSUPPORTED`，不会静默替换。FP16、INT8、INT4 和 FP8 的大小、速度与精度都必须以实际导出和浏览器证据为准。

1.0.1 的 FP32 浏览器报告和 workflow 索引位于 `tools/model-pipeline/reports/1.0.1/remote-validation.json`；这些结果只适用于报告记录的浏览器、操作系统和 NVIDIA 设备矩阵。

上游模型为 PaddlePaddle `PP-Detection_safetensors`，官方元数据声明 Apache-2.0。本项目的转换产物也按 Apache-2.0 分发；使用者仍应保留 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) 中的归属与引用。
