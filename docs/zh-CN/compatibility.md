# 兼容性

[English](../en/compatibility.md)

| 环境                             | 后端                         | 说明                                         |
| -------------------------------- | ---------------------------- | -------------------------------------------- |
| Chrome/Edge 桌面最新版           | WebGPU、WASM                 | WebGPU 优先；需 HTTPS 或 localhost           |
| Safari/macOS/iOS                 | WASM；WebGPU 取决于版本      | 以 `probePPDetectionCapabilities()` 结果为准 |
| Firefox                          | WASM；WebGPU 取决于版本/设置 | 以运行时探测为准                             |
| Android WebView/移动浏览器       | 通常 WASM                    | FP16 默认下载更小，但需关注 CPU 速度和内存   |
| 微信公众号 H5、小程序 `web-view` | 通常 WASM                    | 必须是网页上下文；不支持微信小程序原生推理   |

| 默认模型变体    | 状态    | 发布条件                                                 |
| --------------- | ------- | -------------------------------------------------------- |
| FP32、FP16      | blocked | 需要真实 ONNX、SHA-256、不可变来源 revision 与浏览器验证 |
| INT8、INT4、FP8 | labs    | 需要完成精度、大小、内存和目标后端验证                   |

上述状态描述清单能力，不代表当前仓库已经提供可下载的默认模型。WebGPU FP16 需要 `navigator.gpu` 和 `shader-f16`；WebGPU FP32 不需要 `shader-f16`。WASM/CPU 与 WebGPU 的具体组合必须以变体清单和运行时探测为准。Demo 对手动后端或精度选择严格执行，SDK 会以 `CAPABILITY_UNSUPPORTED` 拒绝清单中不存在的显式组合。原始模型是 float32，不支持 FP64。

WASM 单线程不要求跨源隔离。多线程 WASM 需要 COOP `same-origin` 与 COEP `require-corp` 或 `credentialless`，并要求模型、WASM、Worker 资源满足同源/CORS/CORP 规则。SDK 会根据实际能力选择线程数，而不是假定所有移动 WebView 都支持 SharedArrayBuffer。
