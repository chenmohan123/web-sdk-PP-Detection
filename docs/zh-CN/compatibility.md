# 兼容性

[English](../en/compatibility.md)

兼容性声明只根据下表的实际证据发布。浏览器能力探测可以决定当前页面能否尝试某个后端，不能替代特定浏览器、操作系统和设备的验证。

## 已验证环境

以下证据均针对 1.0.1 FP32 模型、`onnxruntime-web@1.27.0` 和 7 张 fixture，验证日期为 2026-08-30：

| 浏览器                  | 操作系统                | 设备                        | 后端/精度     | 证据                                                                                        |
| ----------------------- | ----------------------- | --------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| Chromium 151.0.7922.34  | Linux 6.17.0-1022-azure | GitHub Actions Linux runner | WASM / FP32   | [`remote-validation.json`](../../tools/model-pipeline/reports/1.0.1/remote-validation.json) |
| Chromium 151.0.7922.174 | Windows 10.0.26200      | NVIDIA Blackwell            | WebGPU / FP32 | [`remote-validation.json`](../../tools/model-pipeline/reports/1.0.1/remote-validation.json) |

## 尚未验证的平台

- Android Chrome、Android WebView、iOS Safari/WebKit 和其他移动浏览器尚未完成真实设备验证；不能仅凭桌面窄屏模拟宣称兼容。
- 微信公众号 H5 和小程序 `web-view` 示例可以作为网页部署参考，但本版本尚未完成真实微信 Android/iOS WebView 验证。页面必须运行在 HTTPS 网页上下文中；微信原生小程序 JavaScript/WASM runtime 不支持。
- Safari、Firefox 以及没有列入上表的桌面浏览器应以 `probePPDetectionCapabilities()` 和实际运行结果为准。

| 默认模型变体    | 状态    | 发布条件                                                     |
| --------------- | ------- | ------------------------------------------------------------ |
| FP32            | stable  | 1.0.1；Linux WASM 与 Windows NVIDIA WebGPU 七张 fixture 通过 |
| FP16            | blocked | 需要真实 ONNX、SHA-256、不可变来源 revision 与浏览器验证     |
| INT8、INT4、FP8 | labs    | 需要完成精度、大小、内存和目标后端验证                       |

上述状态描述清单能力；当前仓库提供 1.0.1 FP32 stable 默认模型。WebGPU FP16 需要 `navigator.gpu` 和 `shader-f16`；WebGPU FP32 不需要 `shader-f16`。WASM/CPU 与 WebGPU 的具体组合必须以变体清单和运行时探测为准。Demo 对手动后端或精度选择严格执行，SDK 会以 `CAPABILITY_UNSUPPORTED` 拒绝清单中不存在的显式组合。原始模型是 float32，不支持 FP64。

WASM 单线程不要求跨源隔离。多线程 WASM 需要 COOP `same-origin` 与 COEP `require-corp` 或 `credentialless`，并要求模型、WASM、Worker 资源满足同源/CORS/CORP 规则。SDK 会根据实际能力选择线程数，而不是假定所有移动 WebView 都支持 SharedArrayBuffer。
