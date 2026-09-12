# Models and precision

## FP32、FP16 与 W8A32（2026-09-12）

当前 Demo 使用 PicoDet **1.0.2**、PP-YOLOE **0.1.1**，两款均提供 FP32、FP16、W8A32 稳定变体，默认 FP32，来源仅 ModelScope 和 Hugging Face，默认 ModelScope。FP16/W8A32 在本机 WASM 和 WebGPU 完成三轮64图识别对照；手机证据仅覆盖原FP32，其他设备按后续实测维护。

| 模型     |     FP32 |                  FP16 |                W8A32 |
| -------- | -------: | --------------------: | -------------------: |
| PicoDet  | 23.24 MB | 14.81 MB（减少36.3%） | 6.12 MB（减少73.7%） |
| PP-YOLOE | 31.95 MB | 16.05 MB（减少49.8%） | 8.23 MB（减少74.3%） |

文件缩小是独立优势。FP16保留敏感算子FP32；W8A32仅压缩权重，激活和卷积计算保持FP32。SDK参数使用 `precision: "int8"` 选择W8A32，实际策略见清单 `quantization`。新清单可用于SDK 0.3.1，无需更换API。完整识别、速度和逐框差异见[三精度对比](../../reports/evaluation/2026-09-12-precision-variants/README.md)。

旧版本清单与以下既有版本记录继续保留；其中对FP16/INT8的labs/blocked限制只描述旧版候选，不覆盖上述已通过的新变体。

[中文](../zh-CN/models.md)

The repository's current PicoDet-L-320 manifest is `models/pp-detection/manifest.json`; its FP32
variant is `stable`. The ONNX asset passes CPU ORT
parity. The official PaddleDetection reference download has confirmed bytes and SHA-256, and
immutable Git LFS, Hugging Face, and ModelScope distribution copies now record revisions,
download URLs, byte sizes, and SHA-256 values. The 1.0.1 FP32 variant has passed seven-fixture
validation on Linux WASM and Windows NVIDIA WebGPU and is the stable SDK default. FP16, mobile
browser, WeChat WebView, and quantized variants are outside this stable compatibility claim.

| Variant         | Status       | Notes                                                                                  |
| --------------- | ------------ | -------------------------------------------------------------------------------------- |
| FP32            | stable       | Current root asset; seven-fixture validation passed on WASM and NVIDIA WebGPU          |
| FP16            | labs/blocked | Requires renewed CPU/WebGPU precision, size, memory, and browser evidence              |
| INT8, INT4, FP8 | labs         | Can be marked stable only after precision, size, memory, and target-backend validation |

The manifest `precision` field distinguishes `fp32`, `fp16`, `int8`, `int4`, and `fp8`; `quantization` records the quantization method, such as `static-qdq`. The SDK selects only manifest variants marked stable and compatible with the chosen backend. Manually selecting an unvalidated combination returns `MODEL_INCOMPATIBLE` or `CAPABILITY_UNSUPPORTED` and never silently substitutes another precision. Size, speed, and accuracy for FP16, INT8, INT4, and FP8 must come from measured export and browser evidence.

The current FP32 browser reports and workflow index are in `tools/model-pipeline/reports/1.0.1/remote-validation.json`; these results apply only to the browser, operating-system, and NVIDIA device matrix recorded in the reports. Historical reports remain evidence and are not model directories.

The upstream PaddlePaddle `PP-Detection_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
