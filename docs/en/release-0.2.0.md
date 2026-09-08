# 0.2.0 release notes

[中文](../zh-CN/release-0.2.0.md)

Version: `web-sdk-pp-detection@0.2.0`. Date: 2026-09-08.

## Installation

```bash
pnpm add web-sdk-pp-detection@0.2.0
```

## Changes

- Add model identity `{ id, version }` to `ModelManager.getCacheEstimate(model?)` and `clearCurrentModelCache(model?)`, plus optional `ModelCache.scope` and `list()`. Estimates deduplicate keys; custom caches without `list()` reject identity-based operations without broader deletion.
- Add `loadTimings.modelSource` and `runtime.runtimeVersion/environment`. Initialization includes manifest retrieval, integrity verification, and Worker startup; results snapshot their actual backend.
- Fix late writes during cache clearing and shared-manager races, WASM fallback after Worker input transfer, and Demo continuous-media session reuse and stale frame configuration.
- Correct documentation: `createPPDetection` requires an explicit `model` or `manifest`; omitting both throws `INVALID_MANIFEST`. The npm package contains no ONNX model binary.

The new APIs are available from 0.2.0. See [API](api.md) and [performance semantics](performance.md) for the complete contract.

## Model, sources, and licenses

The model remains PicoDet-L-320 LCNet `pp-picodet-l-320@1.0.1`, FP32, ONNX opset 11, with 5,787,988 parameters. The default variant is `fp32`. The asset `picodet-l-320-fp32.onnx` is **23,243,834 bytes** with SHA-256 `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`.

The repository model manifest defaults to **Hugging Face**. The live Demo independently configures its source selector to default to **ModelScope**.

The [model manifest](../../models/pp-detection/manifest.json) declares these immutable distribution revisions; all three files have the same size and SHA-256. Explicit source failures do not silently change sources; only `auto` tries alternatives declared in the manifest.

| Source                          | Repository                          | Immutable revision                         |
| ------------------------------- | ----------------------------------- | ------------------------------------------ |
| Hugging Face (manifest default) | `chenmohan/web-sdk-pp-detection`    | `df2b6b79ccdadbaa84fc56ef66369c7cf5cdacff` |
| ModelScope (Demo default)       | `chenmohan/web-sdk-pp-detection`    | `852b3acbb768705c77359362546eae9999f4190c` |
| Git LFS                         | `chenmohan123/web-sdk-PP-Detection` | `f7369860bffbb18a6b850987bab3943e1abb2b12` |

The model comes from PaddleDetection release/2.9 PicoDet-L-320 LCNet, converted through Paddle2ONNX with ONNX postprocessing cleanup. SDK and PaddleDetection/Paddle2ONNX code use Apache-2.0; model licensing follows the upstream official model documentation. ONNX Runtime Web 1.27.0 uses MIT. Redistributability of COCO labels, datasets, and weights must be checked separately under the [third-party notices](../../THIRD_PARTY_NOTICES.md). Hosting providers do not change upstream licenses; the npm tarball excludes model binaries.

## Backends and verification boundaries

The SDK supports ONNX Runtime Web 1.27.0 WASM (CPU) and WebGPU with main/Worker execution. Automatic backend selection prefers WebGPU; runtime fallback requires explicit `allowFallback: true`. Manually selected backend/precision pairs must be declared in the manifest. Multithreaded WASM requires COOP/COEP; single-thread WASM does not require cross-origin isolation.

Real-model evidence is dated **2026-08-30** and covers seven fixtures: Chromium 151.0.7922.34 / Linux 6.17.0-1022-azure / GitHub Actions runner / WASM, and Chromium 151.0.7922.174 / Windows 10.0.26200 / NVIDIA Blackwell / WebGPU. This evidence validates the PicoDet 1.0.1 FP32 asset; see [compatibility](compatibility.md). See the [2026-09-08 release finalization verification](../reviews/2026-09-08-npm-0.2.0-finalization.md) for 0.2.0 package type, installation, build, and main/Worker lifecycle validation. The deterministic tiny ONNX fixture validates package consumption and lifecycle behavior, not real-model accuracy or performance.

FP16 is blocked; INT8/INT4/FP8 are labs; FP64 is unsupported. Mobile browsers, Android/iOS WeChat WebView, Safari, and Firefox still lack independent compatibility evidence. Desktop narrow-viewport emulation is not device evidence. Concurrent cache coordination across tabs/Workers is outside this guarantee. The host page owns camera permissions, video loops, frame pacing, and overlay rendering; native WeChat mini-program JavaScript/WASM runtime is unsupported.
