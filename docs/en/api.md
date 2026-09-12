# API

[中文](../zh-CN/api.md)

All stable entry points are exported from the package root. Do not import `src/` or other internal files. This guide describes the 0.3.2 API; see the [release notes](release-0.3.2.md) for version changes.

## `createPPDetection(options?)`

Returns a `Promise<PPDetectionDetector>`. Supply `model` or `manifest` explicitly; omitting both throws `INVALID_MANIFEST`. The npm package contains no ONNX model binary. Common options:

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`；`int8` 选择当前清单中的 W8A32
- `allowFallback`: whether session failures try the next valid candidate; defaults to `false`. Set it to `true` explicitly to allow fallback; it never rewrites a backend/precision pair absent from the manifest
- `model`: manifest URL, manifest object, or `{ manifest, data }`
- `manifest`: manifest object; `model` takes precedence when both are supplied
- `cache`: enable or disable model caching
- `signal`: cancel loading
- `onProgress`: capability, manifest, model, session, fallback, and ready phases
- `ort.wasm`: WASM asset paths and thread options

For `phase: "model"` and `status: "progress"`, `loadedBytes` and the optional `totalBytes` describe model network-transfer bytes only, not overall initialization progress. They exclude integrity verification and ONNX Runtime Session creation. 响应没有 `Content-Length` 时按清单声明的模型字节数提供 `totalBytes`；缓存、内存或自定义二进制模型可能不产生字节进度。

当前 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 manifest 均含 FP32、FP16、W8A32 stable 资产，默认 ModelScope 和 FP32。`webgpu`、`wasm`（CPU）与具体精度的可用组合仍以 manifest 变体和运行时探测为准。清单中不存在的显式组合会抛出 `CAPABILITY_UNSUPPORTED`；`allowFallback` 只处理有效候选的运行时失败，不会改写无效组合。Demo 在后端选择“自动”时优先 WebGPU，并允许 WebGPU 失败后回退 WASM；手动指定后端或来源时保持严格执行。

```ts
import { createPPDetection } from "web-sdk-pp-detection";

const detector = await createPPDetection({
  model:
    "https://modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/88d23d254e9cc2c98874ae8bd8a7c092612e65f6/picodet-l-320/1.0.2/manifest.json",
  source: "modelscope",
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

`precision: "auto"` 选择清单默认的可用稳定精度；两份当前清单都默认 FP32。显式 `"fp16"` 选择 FP16，显式 `"int8"` 选择 W8A32。`classThresholds` 按 manifest 标签名称覆盖目标检测置信度过滤阈值，未配置的类别回退到全局 `threshold`。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。

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

0.3.0 增加 `allowExperimental?: boolean`，默认 `false`。显式开启时可以运行 `status: "labs"` 的模型；`blocked` 仍拒绝，同精度优先选择稳定变体。这个选项不会放宽 SHA-256 或后端校验，也不代表候选已经达到稳定发布门槛。当前六个已发布变体均为 stable，正常加载无需开启该选项。见[六变体示例](../../examples/model-variants/README.md)。

## 下载选项（0.3.2 起）

0.3.2 的 `CreatePPDetectionOptions` 新增 `download?: { timeoutMs?, idleTimeoutMs?, maxRetries? }`。`timeoutMs` 是单次请求总时限，`idleTimeoutMs` 是响应数据停滞时限，`maxRetries` 是可重试失败后的额外尝试次数；取消仍由 `signal` 负责。升级到 npm `0.3.2` 即可使用；省略配置时应用下表默认策略。

| 参数            |    默认值 | 有效范围                                             |
| --------------- | --------: | ---------------------------------------------------- |
| `timeoutMs`     | `180_000` | 0 至 2,147,483,647 的安全整数；0 关闭单次请求总时限  |
| `idleTimeoutMs` |  `30_000` | 相同整数范围；0 关闭无新增字节时限，等待响应头也计入 |
| `maxRetries`    |       `2` | 0 至 5 的安全整数；0 禁用重试，默认共请求 3 次       |

```ts
import { createPPDetection } from "web-sdk-pp-detection";

const detector = await createPPDetection({
  model:
    "https://modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/88d23d254e9cc2c98874ae8bd8a7c092612e65f6/picodet-l-320/1.0.2/manifest.json",
  source: "modelscope",
  precision: "int8",
  download: { timeoutMs: 180_000, idleTimeoutMs: 30_000, maxRetries: 2 }
});
```

以上代码适用于 npm `0.3.2` 及后续兼容版本。公开 `ModelDownloadOptions` 类型也用于 `ModelManager` 构造配置。非法参数返回 `INVALID_INPUT`。

仅 ONNX 权重下载受该策略控制，清单 JSON 加载不变。只有网络/响应流故障、内部超时和 HTTP 408、429、500、502、503、504 会重试；等待依次为 500、1000、2000、4000、4000 毫秒，可随 `signal` 取消。每次请求保持同一不可变 URL，不拼接残片，重试进度从 0 开始。用户取消、完整性错误、错误 206 范围及其他 HTTP 错误不重试；显式来源失败仍返回 `MODEL_SOURCE_UNAVAILABLE`，其 `cause` 保留下载错误，完整性错误为 `MODEL_INTEGRITY_FAILED`，取消为 `ABORTED`。

模型下载进度新增可选 `attempt`（从 1 开始）和 `maxAttempts`；`modelDownloadMs` 包含重试和等待。持续收到少量字节不能延长总时限；完整字节数与 SHA-256 校验通过后才写缓存。自定义 fetch/reader 忽略取消时 SDK 也会结束等待并尽力清理，迟到结果不能推进进度或写缓存。
