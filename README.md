# PaddleDetection Web SDK

中文入口 | [English](README.en.md)

`web-sdk-pp-detection` 是基于 ONNX Runtime Web 的框架无关 TypeScript SDK，提供图片、Canvas、ImageData、HTMLVideoElement、VideoFrame 和 Worker 单帧目标检测能力，并返回模型、运行时和耗时信息。

## 当前边界

- 工厂在未提供 manifest 时使用内置的 PicoDet 1.0.1 FP32 stable 清单；清单加载失败时返回稳定错误码 `INVALID_MANIFEST`，且不会发起网络访问。
- 模型来源由 manifest 声明，可选择 Git LFS、Hugging Face、ModelScope 或 custom；每个来源必须绑定不可变 revision、大小和 SHA-256。显式来源失败不会静默换源，`auto` 才会按清单尝试。
- SDK 已支持 ONNX Runtime Web 的 `wasm`/`webgpu`、main/worker 执行模式、IndexedDB/内存缓存、模型完整性校验、取消和资源释放。
- PicoDet 1.0.1 的 FP32 变体已标记为 stable，并通过 Linux WASM 与 Windows NVIDIA WebGPU 的七张 fixture 验证；FP16、INT8、INT4、FP8 仍为 labs/blocked，不属于本次发布。
- 常用配置包括 `backend`（`auto`、`webgpu`、`wasm`）、`precision`（`auto`、`fp16`、`fp32`）和 `allowFallback`；`model` 可传入清单 URL 或二进制 `data`。
- 跨域模型需要正确的 CORS；多线程 WASM 需要 COOP/COEP，无法满足时使用单线程。
- `classThresholds` 可按 `person`、`car` 等 manifest 类别覆盖目标检测置信度阈值；未配置类别继承全局阈值。

## 平台边界

- 后续目标平台为 PC 和移动浏览器、公众号 H5、小程序 `web-view` 中承载的 H5 页面。
- 微信原生小程序 JavaScript/WASM runtime 不支持。
- SDK 接收图片和单个视频帧；摄像头权限、视频循环、帧率控制和结果绘制由宿主页面负责。当前 Demo 提供图片、摄像头和视频三种场景。

## 链接

- [GitHub](https://github.com/chenmohan123/web-sdk-PP-Detection)
- [npm](https://www.npmjs.com/package/web-sdk-pp-detection)
- [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)
- [中文文档](docs/zh-CN/quick-start.md)
- [英文文档](docs/en/quick-start.md)

代码采用 Apache-2.0；模型、权重和 COCO 标签的上游许可按 `THIRD_PARTY_NOTICES.md` 逐项核验。
