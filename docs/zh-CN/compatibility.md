# 兼容性

[English](../en/compatibility.md)

兼容性声明只根据下表的实际证据发布。浏览器能力探测可以决定当前页面能否尝试某个后端，不能替代特定浏览器、操作系统和设备的验证。

## 历史 FP32 环境

以下证据均针对 1.0.1 FP32 模型、`onnxruntime-web@1.27.0` 和 7 张 fixture，验证日期为 2026-08-30：

| 浏览器                  | 操作系统                | 设备                        | 后端/精度     | 证据                                                                                        |
| ----------------------- | ----------------------- | --------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| Chromium 151.0.7922.34  | Linux 6.17.0-1022-azure | GitHub Actions Linux runner | WASM / FP32   | [`remote-validation.json`](../../tools/model-pipeline/reports/1.0.1/remote-validation.json) |
| Chromium 151.0.7922.174 | Windows 10.0.26200      | NVIDIA Blackwell            | WebGPU / FP32 | [`remote-validation.json`](../../tools/model-pipeline/reports/1.0.1/remote-validation.json) |

## 开发版小米 15 实测（2026-09-12）

用户在小米 15 的 Android Edge（UA `EdgA/152.0.0.0`）反馈 PP-YOLOE CPU/GPU 正常，提供的后置摄像头截图确认 ModelScope 模型 `0.1.0-labs.1`、实际 WebGPU/FP32/main 和 ORT 1.27.0。证据属于当前开发构建；完整移动验收、真实 Android/HyperOS 版本、CPU 独立运行时记录仍待补充。用户随后明确确认转为 `0.1.0 stable`，见[稳定记录](../../reports/stability/2026-09-12-ppyoloe/README.md)。详见[实测记录](../../reports/distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md)。

## 尚未验证的平台

- Android Chrome、Android WebView、iOS Safari/WebKit 和其他移动浏览器尚未完成真实设备验证；不能仅凭桌面窄屏模拟宣称兼容。
- 微信公众号 H5 和小程序 `web-view` 示例可以作为网页部署参考，但本版本尚未完成真实微信 Android/iOS WebView 验证。页面必须运行在 HTTPS 网页上下文中；微信原生小程序 JavaScript/WASM runtime 不支持。
- Safari、Firefox 以及没有列入上表的桌面浏览器应以 `probePPDetectionCapabilities()` 和实际运行结果为准。

## 当前桌面变体证据（2026-09-12）

PicoDet 1.0.2 与 PP-YOLOE 0.1.1 的 FP32、FP16、W8A32 已完成桌面 WASM/WebGPU 固定 64 图三轮验证，六个变体均为 stable。环境、逐轮识别和差异记录见[三精度对比](../../reports/evaluation/2026-09-12-precision-variants/README.md)。W8A32 对应 SDK 的 `precision: "int8"`。

当前两份清单默认 ModelScope 与 FP32，并可选择 ModelScope 或 Hugging Face。WASM/CPU 与 WebGPU 的具体组合仍以变体清单和运行时探测为准。Demo 对手动后端、精度或来源选择严格执行，SDK 会以 `CAPABILITY_UNSUPPORTED` 拒绝清单中不存在的显式组合。小米 15 实测只覆盖原 FP32，不构成 FP16/W8A32 移动端证据。

WASM 单线程不要求跨源隔离。多线程 WASM 需要 COOP `same-origin` 与 COEP `require-corp` 或 `credentialless`，并要求模型、WASM、Worker 资源满足同源/CORS/CORP 规则。SDK 会根据实际能力选择线程数，而不是假定所有移动 WebView 都支持 SharedArrayBuffer。

## 0.3.1 预处理优化的小米 15 回归（2026-09-12）

用户对预处理优化提交 `1c33a7a` 的局域网 Demo 确认两款模型的 CPU/GPU 测试均正常。截图直接确认 PP-YOLOE 的 ModelScope、WebGPU/FP32/main、ORT 1.27.0 和 Android Edge 152；具体 Android/HyperOS 版本未知，不能用缩减后的 UA 中 Android 10 推断系统版本。没有旧版对照或多次计时样本；完整记录见[本次实机证据](../../reports/releases/2026-09-12-0.3.1/mobile-xiaomi15.md)。
