# PaddleDetection Web SDK

## Fifteen stable variants across five models (2026-09-14)

The Demo now provides PicoDet-L 320 and PP-YOLOE+ S/M/L/X 640, each with stable FP32, FP16, and W8A32 variants. PicoDet uses version 1.0.2 and every PP-YOLOE+ size uses 0.1.1; the SDK API and npm version remain **0.4.0**. Each model defaults to ModelScope and also supports explicit Hugging Face selection. The overall Demo defaults remain PicoDet, ModelScope, and FP32, and an explicitly selected source never silently switches to another source.

| Model           | FP32      | FP16      | W8A32   |
| --------------- | --------: | --------: | -------: |
| PicoDet-L 320   | 23.24 MB  | 14.81 MB  | 6.12 MB  |
| PP-YOLOE+ S 640 | 31.95 MB  | 16.05 MB  | 8.23 MB  |
| PP-YOLOE+ M 640 | 94.02 MB  | 47.10 MB  | 23.82 MB |
| PP-YOLOE+ L 640 | 209.18 MB | 104.70 MB | 52.70 MB |
| PP-YOLOE+ X 640 | 394.16 MB | 197.21 MB | 99.05 MB |

All four PP-YOLOE+ sizes derive from official COCO weights at the same pinned PaddleDetection commit and retain the upstream license and conversion record. Each model pins both distribution sources by revision, path, byte count, and SHA-256; these repositories are project distributions rather than official upstream Hub mirrors. Evidence for the new variants is limited to Windows 11, Chromium 153, and ORT Web 1.27.0 on desktop. Larger models require more download bandwidth, CPU time, and runtime memory.

The nine new M/L/X precision variants were checked over three desktop WASM/WebGPU runs on a fixed 64-image set. Relative to the matching FP32 model, AP loss is at most 0.5 points and at least 95% of FP32 detections are retained at score >= 0.5 and same-class IoU >= 0.5. IoU >= 0.99 is diagnostic only. This subset is not full COCO mAP, and smaller files do not imply proportional peak-memory savings or universal speedups. See the [quality report](reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md), [distribution evidence](reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md), and [model manifests](models/README.md).

## S and PicoDet precision record (2026-09-12)

The 2026-09-12 Demo used PicoDet **1.0.2** and PP-YOLOE **0.1.1**, each with stable FP32, FP16, and W8A32 variants. FP32 and ModelScope remained the defaults, with Hugging Face as the other explicit source. FP16/W8A32 completed three desktop WASM and WebGPU runs on the fixed 64-image set; mobile evidence covers the original FP32 models only.

| Model | FP32 | FP16 | W8A32 |
| --- | ---: | ---: | ---: |
| PicoDet | 23.24 MB | 14.81 MB (36.3% smaller) | 6.12 MB (73.7% smaller) |
| PP-YOLOE | 31.95 MB | 16.05 MB (49.8% smaller) | 8.23 MB (74.3% smaller) |

Smaller files are an independent benefit. FP16 keeps sensitive operators in FP32; W8A32 compresses weights while activations and convolution computation remain FP32. Use SDK `precision: "int8"` for W8A32 and inspect the manifest's `quantization` field for the actual strategy. These manifests work with SDK 0.3.1 without an API change. See the [precision comparison](reports/evaluation/2026-09-12-precision-variants/README.md) for recognition, timing, and box differences.

Historical manifests and version records remain available. Their FP16/INT8 labs or blocked restrictions describe those earlier candidates, not the stable variants above.

[中文](README.md) | English

`web-sdk-pp-detection` is a framework-neutral TypeScript SDK powered by ONNX Runtime Web. It supports single-frame detection from images, Canvas, ImageData, HTMLVideoElement, VideoFrame, and a Worker, and returns model, runtime, and timing information.

## Version and installation

The current SDK version is **0.4.0**:

```bash
pnpm add web-sdk-pp-detection@0.4.0
```

Version 0.4.0 adds an opt-in experimental small-object enhancement API and image Demo control, with tile progress, cancellation, and merged results. See the [API](docs/en/api.md), [performance](docs/en/performance.md), and [release notes](docs/en/release-0.4.0.md).

## Current boundaries

- The factory requires an explicit `model` or `manifest`. Omitting both returns the stable `INVALID_MANIFEST` code without making a model network request. The repository provides 15 stable variants across five models; the npm package contains neither manifests nor ONNX weights.
- Manifest-declared sources may use Git LFS, Hugging Face, ModelScope, or custom hosting. Each source is bound to an immutable revision, byte size, and SHA-256 digest. Explicit source failures never silently switch sources; only `auto` tries the declared alternatives.
- All five current manifests default to ModelScope and allow explicit ModelScope or Hugging Face selection. Explicit source failures never silently switch sources.
- The SDK implements ONNX Runtime Web `wasm`/`webgpu`, main/Worker execution, IndexedDB/memory caching, integrity checks, cancellation, and resource disposal.
- FP32, FP16, and W8A32 are stable for PicoDet 1.0.2 and PP-YOLOE+ S/M/L/X 0.1.1. Evidence for the new M/L/X precisions is limited to three desktop WASM/WebGPU runs on the fixed 64-image set dated 2026-09-14; Xiaomi 15 evidence covers only the original FP32 variant.
- `classThresholds` overrides object-detection thresholds for manifest labels such as `person` and `car`; unspecified labels inherit the global threshold.
- Common options include `backend` (`auto`, `webgpu`, `wasm`), `precision` (`auto`, `fp16`, `fp32`, `int8`), and `allowFallback`; `int8` selects W8A32, and `model` accepts a manifest URL or binary `data`.
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
- [Multi-variant example](examples/model-variants/README.md)

Code is Apache-2.0. Upstream licenses for model weights and COCO labels are tracked in `THIRD_PARTY_NOTICES.md`.

## Stable PP-YOLOE+ models

The current version for PP-YOLOE+ S/M/L/X 640 is **0.1.1**, with stable FP32, FP16, and W8A32 variants for every size. Historical 0.1.0 and labs/blocked candidates retain their original status and evidence. Current manifests load without `allowExperimental`.

All five models use the same three-precision Demo flow, while PicoDet, ModelScope, and FP32 remain the defaults. Manifests pin Hugging Face and ModelScope revisions; switching models cancels prior work, disposes the old instance, and changes the cache identity. Xiaomi 15 coverage remains limited to the [original FP32 device record](reports/distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md).

## Download settings (since 0.3.2)

Version 0.3.2 adds `download.timeoutMs`, `download.idleTimeoutMs`, and `download.maxRetries` for the total request timeout, stalled-transfer timeout, and retry count. Defaults are 180 seconds, 30 seconds, and two retries. Retries stay on the same fixed weight URL and can be cancelled while waiting. See the API guide.

Small object enhancement (0.4.0, experimental): the SDK provides opt-in `smallObjectEnhancement`, reusing one session for the whole image and up to four tiles. Evaluate on static images; false positives and latency may increase. See the [API](docs/en/api.md#small-object-enhancement-unreleased-labs).
