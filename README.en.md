# PaddleDetection Web SDK

[中文](README.md) | English

`web-sdk-pp-detection` is a framework-neutral TypeScript SDK powered by ONNX Runtime Web. It supports single-frame detection from images, Canvas, ImageData, HTMLVideoElement, VideoFrame, and a Worker, and returns model, runtime, and timing information.

## Current boundaries

- Without a manifest, the factory uses the built-in PicoDet 1.0.1 FP32 stable manifest. If manifest loading fails, it returns the stable `INVALID_MANIFEST` error without a network request.
- Manifest-declared sources may use Git LFS, Hugging Face, ModelScope, or custom hosting. Each source is bound to an immutable revision, byte size, and SHA-256 digest. Explicit source failures never silently switch sources; only `auto` tries the declared alternatives.
- The SDK implements ONNX Runtime Web `wasm`/`webgpu`, main/Worker execution, IndexedDB/memory caching, integrity checks, cancellation, and resource disposal.
- PicoDet 1.0.1 FP32 is stable and has passed seven-fixture validation on Linux WASM and Windows NVIDIA WebGPU. FP16, INT8, INT4, and FP8 remain labs/blocked and are outside this release.
- `classThresholds` overrides object-detection thresholds for manifest labels such as `person` and `car`; unspecified labels inherit the global threshold.
- Common options include `backend` (`auto`, `webgpu`, `wasm`), `precision` (`auto`, `fp16`, `fp32`), and `allowFallback`; `model` accepts a manifest URL or binary `data`.
- Cross-origin models need correct CORS; multithreaded WASM needs COOP/COEP, otherwise use single-thread WASM.

## Platform boundaries

- PC/mobile browsers, WeChat Official Account H5, and H5 hosted in a mini-program `web-view` are future target platforms.
- Native WeChat mini-program JavaScript/WASM runtime is unsupported.
- The SDK accepts images and individual video frames; camera permissions, video loops, frame pacing, and overlay rendering remain owned by the host page. The current Demo provides image, camera, and video scenes.

## Links

- [GitHub](https://github.com/chenmohan123/web-sdk-PP-Detection)
- [npm](https://www.npmjs.com/package/web-sdk-pp-detection)
- [Live Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)
- [Chinese docs](docs/zh-CN/quick-start.md)
- [English docs](docs/en/quick-start.md)

Code is Apache-2.0. Upstream licenses for model weights and COCO labels are tracked in `THIRD_PARTY_NOTICES.md`.
