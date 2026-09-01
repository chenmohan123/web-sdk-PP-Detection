# Models and precision

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
