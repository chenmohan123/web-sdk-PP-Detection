# Models and precision

[中文](../zh-CN/models.md)

The repository's PicoDet-L-320 manifest is `models/pp-detection/1.0.0/manifest.json`, and
its status remains `labs/blocked`. A local FP32 ONNX candidate exists and passes CPU ORT
parity. The official PaddleDetection reference download has confirmed bytes and SHA-256, and
immutable Git LFS, Hugging Face, and ModelScope distribution copies now record revisions,
download URLs, byte sizes, and SHA-256 values. Complete browser evidence and source
licensing verification are still pending, so it is not yet a stable SDK default. Pass a
verified runtime or custom manifest when using the SDK.

| Variant         | Status  | Notes                                                                                             |
| --------------- | ------- | ------------------------------------------------------------------------------------------------- |
| FP32, FP16      | blocked | Require a real ONNX file, SHA-256, immutable source revision, and browser evidence before release |
| INT8, INT4, FP8 | labs    | Can be marked stable only after precision, size, memory, and target-backend validation            |

The manifest `precision` field distinguishes `fp32`, `fp16`, `int8`, `int4`, and `fp8`; `quantization` records the quantization method, such as `static-qdq`. The SDK selects only manifest variants marked stable and compatible with the chosen backend. Manually selecting an unvalidated combination returns `MODEL_INCOMPATIBLE` or `CAPABILITY_UNSUPPORTED` and never silently substitutes another precision. Size, speed, and accuracy for FP16, INT8, INT4, and FP8 must come from measured export and browser evidence.

The upstream PaddlePaddle `PP-Detection_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
