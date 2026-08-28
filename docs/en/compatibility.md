# Compatibility

[中文](../zh-CN/compatibility.md)

| Environment                                          | Backend                                  | Notes                                                                    |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Current desktop Chrome/Edge                          | WebGPU, WASM                             | WebGPU preferred; HTTPS or localhost required                            |
| Safari on macOS/iOS                                  | WASM; WebGPU depends on version          | Trust `probePPDetectionCapabilities()`                                   |
| Firefox                                              | WASM; WebGPU depends on version/settings | Trust runtime probing                                                    |
| Android WebView/mobile browser                       | Usually WASM                             | FP16 is smaller; account for CPU speed and memory peak                   |
| WeChat Official Account H5 / mini-program `web-view` | Usually WASM                             | Must be a web context; it does not support native mini-program inference |

| Default model variant | Status  | Release condition                                                   |
| --------------------- | ------- | ------------------------------------------------------------------- |
| FP32, FP16            | blocked | Real ONNX, SHA-256, immutable source revision, and browser evidence |
| INT8, INT4, FP8       | labs    | Precision, size, memory, and target-backend validation              |

These statuses describe manifest capability, not a downloadable default model in this repository. WebGPU FP16 requires `navigator.gpu` and `shader-f16`; WebGPU FP32 does not require `shader-f16`. WASM/CPU and WebGPU combinations must follow the variant manifest and runtime probing. The Demo keeps manual backend and precision choices strict, and the SDK rejects explicit pairs absent from the manifest with `CAPABILITY_UNSUPPORTED`. The source model is float32; FP64 is unsupported.

Single-thread WASM does not require cross-origin isolation. Multithreaded WASM needs COOP `same-origin` plus COEP `require-corp` or `credentialless`; model, WASM, and Worker assets must also satisfy same-origin/CORS/CORP rules. The SDK chooses threads from actual capabilities instead of assuming every mobile WebView has SharedArrayBuffer.
