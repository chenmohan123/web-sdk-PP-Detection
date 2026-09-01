# Compatibility

[中文](../zh-CN/compatibility.md)

Compatibility claims are limited to the evidence below. Capability probing can decide whether a page may try a backend; it does not replace validation on a specific browser, operating system, and device.

## Verified environments

The following evidence covers the 1.0.1 FP32 model, `onnxruntime-web@1.27.0`, and seven fixtures. Both runs were verified on 2026-08-30:

| Browser                 | Operating system        | Device                      | Backend/precision | Evidence                                                                                    |
| ----------------------- | ----------------------- | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| Chromium 151.0.7922.34  | Linux 6.17.0-1022-azure | GitHub Actions Linux runner | WASM / FP32       | [`remote-validation.json`](../../tools/model-pipeline/reports/1.0.1/remote-validation.json) |
| Chromium 151.0.7922.174 | Windows 10.0.26200      | NVIDIA Blackwell            | WebGPU / FP32     | [`remote-validation.json`](../../tools/model-pipeline/reports/1.0.1/remote-validation.json) |

## Unverified platforms

- Android Chrome, Android WebView, iOS Safari/WebKit, and other mobile browsers still need real-device validation. Desktop narrow-viewport emulation is not evidence of mobile compatibility.
- The WeChat Official Account H5 and mini-program `web-view` example is a web deployment reference, but this release has no real WeChat Android/iOS WebView evidence. The page must run in an HTTPS web context; native mini-program JavaScript/WASM inference is unsupported.
- Safari, Firefox, and desktop browsers not listed above should be evaluated with `probePPDetectionCapabilities()` and an actual run.

| Default model variant | Status  | Release condition                                                              |
| --------------------- | ------- | ------------------------------------------------------------------------------ |
| FP32                  | stable  | 1.0.1; seven-fixture validation passed on Linux WASM and Windows NVIDIA WebGPU |
| FP16                  | blocked | Real ONNX, SHA-256, immutable source revision, and browser evidence            |
| INT8, INT4, FP8       | labs    | Precision, size, memory, and target-backend validation                         |

These statuses describe manifest capability; this repository provides the 1.0.1 FP32 stable default model. WebGPU FP16 requires `navigator.gpu` and `shader-f16`; WebGPU FP32 does not require `shader-f16`. WASM/CPU and WebGPU combinations must follow the variant manifest and runtime probing. The Demo keeps manual backend and precision choices strict, and the SDK rejects explicit pairs absent from the manifest with `CAPABILITY_UNSUPPORTED`. The source model is float32; FP64 is unsupported.

Single-thread WASM does not require cross-origin isolation. Multithreaded WASM needs COOP `same-origin` plus COEP `require-corp` or `credentialless`; model, WASM, and Worker assets must also satisfy same-origin/CORS/CORP rules. The SDK chooses threads from actual capabilities instead of assuming every mobile WebView has SharedArrayBuffer.
