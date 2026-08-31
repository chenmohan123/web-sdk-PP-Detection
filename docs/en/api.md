# API

[中文](../zh-CN/api.md)

All stable entry points are exported from the package root. Do not import `src/` or other internal files.

## `createPPDetection(options?)`

Returns a `Promise<PPDetectionDetector>`. Common options:

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`; the default manifest has no INT8 variant
- `allowFallback`: whether session failures try the next valid candidate; defaults to `false`. Set it to `true` explicitly to allow fallback; it never rewrites a backend/precision pair absent from the manifest
- `model`: manifest URL, manifest object, or `{ manifest, data }`
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
- `listModelCache()` / `clearModelCache()`: inspect or clear the detector's model cache.
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

`probePPDetectionCapabilities()`, `listModelCache()`, `clearModelCache()`, `parseModelManifest()`, `PPDetectionError`, default manifest/WASM URLs, and all public TypeScript contracts. Runtime messages remain stable English strings; localize UI using `error.code`.
