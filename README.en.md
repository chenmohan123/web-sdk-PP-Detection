# PaddleDetection Web SDK

[中文](README.md) | English

`web-sdk-pp-detection` is a framework-neutral TypeScript SDK powered by ONNX Runtime Web. It supports single-frame detection from images, Canvas, ImageData, HTMLVideoElement, VideoFrame, and a Worker, and returns model, runtime, and timing information.

## Version and installation

The current SDK version is **0.3.0**:

```bash
pnpm add web-sdk-pp-detection@0.3.0
```

Version 0.3.0 adds the stable PP-YOLOE+ S 640 FP32 model, explicit experimental-variant opt-in, and a result-first Demo. See the [API](docs/en/api.md), [performance](docs/en/performance.md), and [release notes](docs/en/release-0.3.0.md).

## Current boundaries

- The factory requires an explicit `model` or `manifest`. Omitting both returns the stable `INVALID_MANIFEST` error without a model network request. The repository provides PicoDet 1.0.1 and PP-YOLOE 0.1.0 FP32 stable manifests and externally distributed models; the npm package contains no ONNX model binary.
- Manifest-declared sources may use Git LFS, Hugging Face, ModelScope, or custom hosting. Each source is bound to an immutable revision, byte size, and SHA-256 digest. Explicit source failures never silently switch sources; only `auto` tries the declared alternatives.
- The repository model manifest defaults to Hugging Face. The live Demo independently configures its source selector to default to ModelScope.
- The SDK implements ONNX Runtime Web `wasm`/`webgpu`, main/Worker execution, IndexedDB/memory caching, integrity checks, cancellation, and resource disposal.
- PicoDet 1.0.1 FP32 is stable and has passed seven-fixture validation on Linux WASM and Windows NVIDIA WebGPU. FP16, INT8, INT4, and FP8 remain labs/blocked and are outside this release.
- `classThresholds` overrides object-detection thresholds for manifest labels such as `person` and `car`; unspecified labels inherit the global threshold.
- Common options include `backend` (`auto`, `webgpu`, `wasm`), `precision` (`auto`, `fp16`, `fp32`), and `allowFallback`; `model` accepts a manifest URL or binary `data`.
- Cross-origin models need correct CORS; multithreaded WASM needs COOP/COEP, otherwise use single-thread WASM.

## Platform boundaries

- Target platforms include PC/mobile browsers, WeChat Official Account H5, and H5 hosted in a mini-program `web-view`; the repository includes Vanilla, React, Vue, CDN, and WeChat H5/WebView examples.
- PP-YOLOE has basic CPU/GPU functional validation on Xiaomi 15 with Android Edge. Other mobile browsers and WeChat WebView still need independent validation; desktop narrow-viewport emulation is not device evidence.
- Native WeChat mini-program JavaScript/WASM runtime is unsupported.
- The SDK accepts images and individual video frames; camera permissions, video loops, frame pacing, and overlay rendering remain owned by the host page. The current Demo provides image, camera, and video scenes.

## Links

- [GitHub](https://github.com/chenmohan123/web-sdk-PP-Detection)
- [npm](https://www.npmjs.com/package/web-sdk-pp-detection)
- [Live Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)
- [Chinese docs](docs/zh-CN/quick-start.md)
- [English docs](docs/en/quick-start.md)

Code is Apache-2.0. Upstream licenses for model weights and COCO labels are tracked in `THIRD_PARTY_NOTICES.md`.

## PP-YOLOE 稳定模型

PP-YOLOE+ S 640 FP32 已于 2026-09-12 按用户确认标记为 **0.1.0 stable**，依据桌面 64 张 COCO 子集验证及小米 15 CPU/GPU 人工实测。当前清单默认可加载，无需设置 `allowExperimental`；其他 labs 候选仍须显式开启，blocked 仍会被拒绝。见[稳定记录](reports/stability/2026-09-12-ppyoloe/README.md)与[接入说明](examples/ppyoloe-candidate/README.md)。

在线 Demo 提供 PicoDet 与 PP-YOLOE 模型选择，PicoDet 继续默认。稳定清单复用 Hugging Face 和 ModelScope 的固定模型文件，切换时取消旧任务、释放实例并更新缓存身份。现有 Hub 实验清单是历史快照；当前稳定清单随 Demo 构建，并归档于 v0.3.0 发布标签。模型分发见[历史记录](reports/distribution/2026-09-11-ppyoloe/README.md)，小米 15 的实际设备范围见[实测记录](reports/distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md)。
