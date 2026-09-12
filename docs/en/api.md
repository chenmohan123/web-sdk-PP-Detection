# API

[中文](../zh-CN/api.md)

All stable entry points are exported from the package root. Do not import `src/` or other internal files. This guide describes the 0.3.1 API; see the [release notes](release-0.3.1.md) for version changes.

## `createPPDetection(options?)`

Returns a `Promise<PPDetectionDetector>`. Supply `model` or `manifest` explicitly; omitting both throws `INVALID_MANIFEST`. The npm package contains no ONNX model binary. Common options:

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`; the default manifest has no INT8 variant
- `allowFallback`: whether session failures try the next valid candidate; defaults to `false`. Set it to `true` explicitly to allow fallback; it never rewrites a backend/precision pair absent from the manifest
- `model`: manifest URL, manifest object, or `{ manifest, data }`
- `manifest`: manifest object; `model` takes precedence when both are supplied
- `cache`: enable or disable model caching
- `signal`: cancel loading
- `onProgress`: capability, manifest, model, session, fallback, and ready phases
- `ort.wasm`: WASM asset paths and thread options

For `phase: "model"` and `status: "progress"`, `loadedBytes` and the optional `totalBytes` describe model network-transfer bytes only, not overall initialization progress. They exclude integrity verification and ONNX Runtime Session creation. `totalBytes` can be absent when the response has no `Content-Length`, and cache, memory, or custom binary model sources may emit no byte progress.

The default PicoDet 1.0.1 manifest contains a downloadable stable FP32 asset with WASM and WebGPU browser evidence. Available combinations of `webgpu`, `wasm` (CPU), `fp32`, `fp16`, `int8`, `int4`, and `fp8` must follow manifest variants and runtime probing. Explicit pairs absent from the manifest throw `CAPABILITY_UNSUPPORTED`. `allowFallback` handles runtime failures among valid candidates; it does not rewrite an invalid pair. The Demo prefers WebGPU when the backend is Auto and allows a failed WebGPU run to fall back to WASM; manually selected backends remain strict. The source model is float32; FP64 inference is unsupported.

```ts
import { createPPDetection } from "web-sdk-pp-detection";

const detector = await createPPDetection({
  model: "https://models.example.com/pp-detection/manifest.json",
  backend: "wasm",
  precision: "fp32",
  allowFallback: false,
  onProgress: ({ phase, status }) => console.log(phase, status)
});
await detector.dispose();
```

## `PPDetectionDetector`

- `detect(image, { threshold, classThresholds, signal, timestampMs, metadata })`: accepts a Blob, CanvasImageSource, `HTMLVideoElement`, a single `VideoFrame`, or a normalized raster.
- `dispose()`: waits for queued work and releases the Worker/session; it is idempotent.
- `getCacheEstimate()` / `clearCurrentModelCache()` / `clearAllCache()`: inspect SDK cache usage, clear the current instance's cache key, or clear all SDK model caches. Use `dispose()` to release the session.
- `model`, `runtime`, `capabilities`, `loadTimings`: actual loaded configuration.

```ts
import type { PPDetectionDetector } from "web-sdk-pp-detection";

declare const detector: PPDetectionDetector;
declare const file: Blob;

const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    person: 0.6,
    car: 0.5
  }
});
```

`precision: "auto"` selects the first available stable precision in manifest variant order. The default PicoDet keeps only the FP32 evidence, so the SDK does not guess an FP16 switch. `classThresholds` overrides object-detection confidence filtering for matching manifest label names and falls back to the global `threshold` for unspecified classes. Unknown class names and values outside `0` through `1` are rejected.

When a manifest sets `preprocessing.doResize` to `false`, both input dimensions must fit within the model input size. Larger images throw `INVALID_INPUT` instead of being silently cropped.

Preprocessing supports `interpolation: "bilinear"` and `interpolation: "bicubic"`. The legacy public
`ModelManifest` `resample` field accepts only Pillow/Paddle `2` (bilinear) and `3` (bicubic);
`3` adapts to `bicubic`, while unimplemented values are rejected with `INVALID_MANIFEST`. When no
interpolation is declared, the runtime manifest defaults to bilinear.

Hosts own camera permissions, video playback, and frame pacing. Submit one frame at a time and await its Promise before submitting the next; cancel in-flight work and call `dispose()` when media stops.

## Other exports

`probePPDetectionCapabilities()`, `ModelManager`, `clearModelCache()`, `parseModelManifest()`, `PPDetectionError`, and public TypeScript contracts. Localize UI using the stable `error.code`.

Without an active detector, use `ModelManager.getCacheEstimate({ id, version })` and
`clearCurrentModelCache({ id, version })` with the actual manifest identity to inspect or clear all its variants and sources.
The identity overloads, `ModelCache.scope`, and `list()` are available from 0.2.0.
Estimates deduplicate cache keys; they do not represent origin quota or process memory. Custom caches must implement
the optional `list()` method for identity-based operations, or receive `CAPABILITY_UNSUPPORTED` without a broader deletion.

Managers sharing an IndexedDB database in the same JavaScript execution environment share invalidation generations
and serialize cache operations. Downloads started before clearing cannot repopulate the cache; new loads can cache normally.
The module-level `clearModelCache()` also clears active cache copies in that scope, but does not release inference sessions.
The Demo cancels and awaits current work, releases the session, clears caches, and refreshes usage. Concurrent tabs or Workers
are outside the cross-environment coordination guarantee.

`loadTimings.modelSource` distinguishes `network`, `cache`, and `memory`. `runtime.runtimeVersion` and `runtime.environment` describe the loaded ORT and current environment; each result snapshots its execution backend. These optional fields are available from 0.2.0. See [performance](performance.md) for timing semantics.

## 实验变体选项（0.3.0 起）

0.3.0 增加 `allowExperimental?: boolean`，默认 `false`。显式开启时可以运行 `status: "labs"` 的模型；`blocked` 仍拒绝，同精度优先选择稳定变体。这个选项不会放宽 SHA-256 或后端校验，也不代表候选已经达到稳定发布门槛。PP-YOLOE 0.1.0 为稳定模型，正常加载无需开启该选项。见[PP-YOLOE 候选接入](../../examples/ppyoloe-candidate/README.md)和[验证证据](../../reports/evaluation/2026-09-11-ppyoloe/README.md)。
