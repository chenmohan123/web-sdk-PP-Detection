# PaddleDetection Web SDK

## FP32、FP16 与 W8A32（2026-09-12）

当前 Demo 使用 PicoDet **1.0.2**、PP-YOLOE **0.1.1**，两款均提供 FP32、FP16、W8A32 稳定变体，默认 FP32，来源仅 ModelScope 和 Hugging Face，默认 ModelScope。FP16/W8A32 在本机 WASM 和 WebGPU 完成三轮64图识别对照；手机证据仅覆盖原FP32，其他设备按后续实测维护。

| 模型     |     FP32 |                  FP16 |                W8A32 |
| -------- | -------: | --------------------: | -------------------: |
| PicoDet  | 23.24 MB | 14.81 MB（减少36.3%） | 6.12 MB（减少73.7%） |
| PP-YOLOE | 31.95 MB | 16.05 MB（减少49.8%） | 8.23 MB（减少74.3%） |

文件缩小是独立优势。FP16保留敏感算子FP32；W8A32仅压缩权重，激活和卷积计算保持FP32。SDK参数使用 `precision: "int8"` 选择W8A32，实际策略见清单 `quantization`。新清单可用于SDK 0.3.1，无需更换API。完整识别、速度和逐框差异见[三精度对比](reports/evaluation/2026-09-12-precision-variants/README.md)。

旧版本清单与以下既有版本记录继续保留；其中对FP16/INT8的labs/blocked限制只描述旧版候选，不覆盖上述已通过的新变体。

中文入口 | [English](README.en.md)

`web-sdk-pp-detection` 是基于 ONNX Runtime Web 的框架无关 TypeScript SDK，提供图片、Canvas、ImageData、HTMLVideoElement、VideoFrame 和 Worker 单帧目标检测能力，并返回模型、运行时和耗时信息。

## 版本与安装

当前 SDK 版本为 **0.3.1**：

```bash
pnpm add web-sdk-pp-detection@0.3.1
```

0.3.1 优化两款模型共用的预处理，保持检测结果一致；本机 PP-YOLOE WebGPU 热端到端中位数降低 25.5%，并完成小米 15 基础功能回归。详见 [API](docs/zh-CN/api.md)、[性能](docs/zh-CN/performance.md)和[发布说明](docs/zh-CN/release-0.3.1.md)。

## 当前边界

- 工厂必须显式传入 `model` 或 `manifest`；两者均缺省时返回稳定错误码 `INVALID_MANIFEST`，且不会发起模型网络访问。仓库提供 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 的六个稳定变体清单；npm 包不内置清单或 ONNX 模型本体。
- 模型来源由 manifest 声明，可选择 Git LFS、Hugging Face、ModelScope 或 custom；每个来源必须绑定不可变 revision、大小和 SHA-256。显式来源失败不会静默换源，`auto` 才会按清单尝试。
- 两份当前 manifest 均默认 ModelScope，并允许显式选择 ModelScope 或 Hugging Face；显式来源失败时不会静默换源。
- SDK 已支持 ONNX Runtime Web 的 `wasm`/`webgpu`、main/worker 执行模式、IndexedDB/内存缓存、模型完整性校验、取消和资源释放。
- PicoDet 1.0.2 与 PP-YOLOE 0.1.1 的 FP32、FP16、W8A32 均为 stable。FP16/W8A32 证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图三轮验证；小米 15 实测仅覆盖原 FP32。
- 常用配置包括 `backend`（`auto`、`webgpu`、`wasm`）、`precision`（`auto`、`fp16`、`fp32`、`int8`）和 `allowFallback`；其中 `int8` 选择 W8A32，`model` 可传入清单 URL 或二进制 `data`。
- 跨域模型需要正确的 CORS；多线程 WASM 需要 COOP/COEP，无法满足时使用单线程。
- `classThresholds` 可按 `person`、`car` 等 manifest 类别覆盖目标检测置信度阈值；未配置类别继承全局阈值。

## 平台边界

- 目标平台包括 PC 和移动浏览器、公众号 H5、小程序 `web-view` 中承载的 H5 页面；仓库已提供 Vanilla、React、Vue、CDN 和微信 H5/WebView 示例。
- PP-YOLOE 已有小米 15 Android Edge CPU/GPU 基础功能实测；其他移动浏览器和微信 WebView 仍待独立验证，不能把桌面窄屏模拟当作设备证据。
- 微信原生小程序 JavaScript/WASM runtime 不支持。
- SDK 接收图片和单个视频帧；摄像头权限、视频循环、帧率控制和结果绘制由宿主页面负责。当前 Demo 提供图片、摄像头和视频三种场景。

## 链接

- [GitHub](https://github.com/chenmohan123/web-sdk-PP-Detection)
- [npm](https://www.npmjs.com/package/web-sdk-pp-detection)
- [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)
- [中文文档](docs/zh-CN/quick-start.md)
- [英文文档](docs/en/quick-start.md)
- [六变体示例](examples/model-variants/README.md)

代码采用 Apache-2.0；模型、权重和 COCO 标签的上游许可按 `THIRD_PARTY_NOTICES.md` 逐项核验。

## PP-YOLOE 稳定模型

PP-YOLOE+ S 640 FP32 的 0.1.0 稳定记录仍保留为历史证据；当前模型版本为 **0.1.1**，新增 FP16 与 W8A32 稳定变体。当前清单默认可加载，无需设置 `allowExperimental`；旧 labs 候选仍须显式开启，blocked 仍会被拒绝。见[稳定记录](reports/stability/2026-09-12-ppyoloe/README.md)与[六变体示例](examples/model-variants/README.md)。

在线 Demo 提供两模型与三精度选择，PicoDet、ModelScope、FP32 继续作为默认组合。清单使用 Hugging Face 和 ModelScope 的固定 revision，切换时取消旧任务、释放实例并更新缓存身份。旧 Hub 实验清单和 v0.3.0 资产是历史快照；模型分发见[历史记录](reports/distribution/2026-09-11-ppyoloe/README.md)，小米 15 的实际设备范围见[实测记录](reports/distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md)。

## 工作区维护版下载配置

当前工作区维护版本新增 `download.timeoutMs`、`download.idleTimeoutMs` 与 `download.maxRetries`，分别控制请求总时限、数据停滞时限和重试次数。该配置尚未随 npm `0.3.1` 发布；公开包示例不传这些选项，不能把它写成 `0.3.1` 的公开能力。
