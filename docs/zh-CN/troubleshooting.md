# 故障排查

[English](../en/troubleshooting.md)

## 下载失败或进度不动

先确认当前选择的固定 manifest URL 可访问、响应为 200、CORS 允许当前 Origin，并且 HTTPS 页面没有混入 HTTP 资源。再核对 manifest 中所选来源的模型 URL、`bytes` 与 SHA-256。响应没有 `Content-Length` 时使用清单声明的总字节数，下载仍可继续。显式选择 ModelScope 或 Hugging Face 失败时不会静默换源；需要换源时由用户重新选择，或明确使用 `source: "auto"`。

0.3.2 提供 `download.timeoutMs`、`download.idleTimeoutMs` 和 `download.maxRetries`，用于区分总请求超时、数据停滞和可重试失败。默认最多重试 2 次，且只重试同一固定权重 URL；使用 `AbortSignal` 可取消下载和重试等待。旧版消费者需要升级到 0.3.2 才能使用此策略。

## WebGPU 不可用

调用 `probePPDetectionCapabilities()` 查看 `webgpu`、`webgpuFp16`、`diagnostics`。确认浏览器安全上下文、GPU 驱动和 `shader-f16`，或手动设置 `backend: "wasm"`。自动模式会记录 `runtime.fallbacks`，回退不是静默的软件假 GPU。

## WASM 多线程失败

检查 `crossOriginIsolated`、COOP/COEP、Worker 和 WASM 的 CORS/CORP。先使用单线程 WASM 验证模型契约，再逐项恢复隔离策略。

## 自定义清单无效

使用 `parseModelManifest()`，核对 `schemaVersion`、模型实际输入输出、标签、预处理、后处理、opset、字节数和 SHA-256。PicoDet 与 PP-YOLOE 的输入尺寸和输出名称不同；不要复制其他 SDK 的固定形状。模型能被 ONNX Runtime 打开不代表后处理契约正确。

## 变体无法加载

确认清单包含所选稳定变体及当前后端。界面中的 W8A32 对应 SDK 的 `precision: "int8"`；不要传入 `"w8a32"`。FP16/W8A32 当前验证证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图，移动设备应单独验证。

## 微信 H5/WebView

页面必须是 HTTPS 业务域名，模型和 WASM 下载域名需加入允许列表。微信小程序原生运行环境不提供本 SDK 所需的 DOM、Worker 和 WebGPU/WASM 页面能力；请使用公众号 H5 或小程序 `web-view`，不要宣称原生小程序推理。

## 内存不足或取消

单页只保留一个检测器，检测完成或离开页面时 `await detector.dispose()`。用 `AbortController` 取消下载/检测，取消后为下一次操作创建新的 controller。
