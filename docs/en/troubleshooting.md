# Troubleshooting

[中文](../zh-CN/troubleshooting.md)

## Download failure or stalled progress

先确认当前选择的固定 manifest URL 可访问、响应为 200、CORS 允许当前 Origin，并且 HTTPS 页面没有混入 HTTP 资源。再核对 manifest 中所选来源的模型 URL、`bytes` 与 SHA-256。响应没有 `Content-Length` 时使用清单声明的总字节数，下载仍可继续。显式选择 ModelScope 或 Hugging Face 失败时不会静默换源；需要换源时由用户重新选择，或明确使用 `source: "auto"`。

当前工作区维护版本提供 `download.timeoutMs`、`download.idleTimeoutMs` 和 `download.maxRetries`，用于区分总请求超时、数据停滞和可重试失败。它们尚未随 npm `0.3.1` 发布；公开包消费者应继续使用 `AbortSignal` 取消，并在失败后由宿主决定是否重试。

## WebGPU is unavailable

Call `probePPDetectionCapabilities()` and inspect `webgpu`, `webgpuFp16`, and `diagnostics`. Check the secure context, GPU driver, and `shader-f16`, or set `backend: "wasm"`. Auto mode records `runtime.fallbacks`; fallback is explicit, not a silently software-backed GPU.

## Multithreaded WASM fails

Check `crossOriginIsolated`, COOP/COEP, and CORS/CORP for Worker and WASM assets. First validate the model contract with single-thread WASM, then restore isolation one policy at a time.

## Custom manifest is invalid

使用 `parseModelManifest()`，核对 `schemaVersion`、模型实际输入输出、标签、预处理、后处理、opset、字节数和 SHA-256。PicoDet 与 PP-YOLOE 的输入尺寸和输出名称不同；不要复制其他 SDK 的固定形状。模型能被 ONNX Runtime 打开不代表后处理契约正确。

## 变体无法加载

确认清单包含所选稳定变体及当前后端。界面中的 W8A32 对应 SDK 的 `precision: "int8"`；不要传入 `"w8a32"`。FP16/W8A32 当前验证证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图，移动设备应单独验证。

## WeChat H5/WebView

The page must use an HTTPS business domain, and model/WASM hosts must be allow-listed. The native mini-program runtime does not provide the DOM, Worker, and WebGPU/WASM page surface this SDK needs. Use an Official Account H5 page or mini-program `web-view`; do not claim native mini-program inference.

## Out of memory or cancellation

Keep one detector per page and `await detector.dispose()` after detection or page teardown. Use an `AbortController` to cancel loading/detection, and create a fresh controller for the next operation.
