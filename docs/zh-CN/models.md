# 模型与精度

## FP32、FP16 与 W8A32（2026-09-12）

当前 Demo 使用 PicoDet **1.0.2**、PP-YOLOE **0.1.1**，两款均提供 FP32、FP16、W8A32 稳定变体，默认 FP32，来源仅 ModelScope 和 Hugging Face，默认 ModelScope。FP16/W8A32 在本机 WASM 和 WebGPU 完成三轮64图识别对照；手机证据仅覆盖原FP32，其他设备按后续实测维护。

| 模型     |     FP32 |                  FP16 |                W8A32 |
| -------- | -------: | --------------------: | -------------------: |
| PicoDet  | 23.24 MB | 14.81 MB（减少36.3%） | 6.12 MB（减少73.7%） |
| PP-YOLOE | 31.95 MB | 16.05 MB（减少49.8%） | 8.23 MB（减少74.3%） |

文件缩小是独立优势。FP16保留敏感算子FP32；W8A32仅压缩权重，激活和卷积计算保持FP32。SDK参数使用 `precision: "int8"` 选择W8A32，实际策略见清单 `quantization`。新清单可用于SDK 0.3.1，无需更换API。完整识别、速度和逐框差异见[三精度对比](../../reports/evaluation/2026-09-12-precision-variants/README.md)。

旧版本清单与以下既有版本记录继续保留；其中对FP16/INT8的labs/blocked限制只描述旧版候选，不覆盖上述已通过的新变体。

[English](../en/models.md)

当前仓库的 PicoDet-L-320 清单为 `models/pp-detection/manifest.json`，FP32
变体状态为 `stable`。该版本的 ONNX 文件已完成 CPU ORT parity；PaddleDetection
官方参考下载的字节数和 SHA-256 已核验，Git LFS、Hugging Face、ModelScope 三类
不可变分发来源也已记录 revision、下载地址、大小和 SHA-256；1.0.1 FP32 已在 Linux
WASM 和 Windows NVIDIA WebGPU 上完成 7 张 fixture 验证，并作为 SDK 默认加载的 stable
变体。FP16、移动端、微信 WebView 及量化版本不属于本次稳定兼容承诺。

| 变体            | 状态         | 说明                                                      |
| --------------- | ------------ | --------------------------------------------------------- |
| FP32            | stable       | 当前根目录资产；WASM 和 NVIDIA WebGPU 七张 fixture 通过   |
| FP16            | labs/blocked | 需要重新完成 CPU/WebGPU 精度、大小、内存和浏览器证据      |
| INT8、INT4、FP8 | labs         | 只有在精度、大小、内存和目标后端验证完成后才能标记 stable |

manifest 中的 `precision` 区分 `fp32`、`fp16`、`int8`、`int4` 和 `fp8`，`quantization` 记录量化方法（例如 static-qdq）。SDK 只会选择清单中声明为 stable 且与后端匹配的变体；手动选择未验证组合会返回 `MODEL_INCOMPATIBLE` 或 `CAPABILITY_UNSUPPORTED`，不会静默替换。FP16、INT8、INT4 和 FP8 的大小、速度与精度都必须以实际导出和浏览器证据为准。

当前 FP32 浏览器报告和 workflow 索引位于 `tools/model-pipeline/reports/1.0.1/remote-validation.json`；这些结果只适用于报告记录的浏览器、操作系统和 NVIDIA 设备矩阵。历史报告是验证证据，不是当前模型目录。

上游模型为 PaddlePaddle `PP-Detection_safetensors`，官方元数据声明 Apache-2.0。本项目的转换产物也按 Apache-2.0 分发；使用者仍应保留 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) 中的归属与引用。
