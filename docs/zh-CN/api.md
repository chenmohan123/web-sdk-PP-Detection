# API

[English](../en/api.md)

所有稳定入口都从包根路径导出，不要导入 `src/` 或其他内部文件。本文描述 0.3.2 API，版本变更见[发布说明](release-0.3.2.md)。

## `createPPDetection(options?)`

返回 `Promise<PPDetectionDetector>`。必须显式提供 `model` 或 `manifest`；两者均省略时抛出 `INVALID_MANIFEST`。npm 包不内置 ONNX 模型本体。常用选项：

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`；`int8` 选择当前清单中的 W8A32
- `allowFallback`: 会话失败时是否尝试下一有效候选；默认 `false`。只有显式设置为 `true` 才会回退，且不会改写清单中不存在的后端/精度组合
- `model`: 清单 URL、清单对象或 `{ manifest, data }`
- `manifest`: 清单对象；`model` 与 `manifest` 同时存在时优先使用 `model`
- `cache`: 是否使用模型缓存
- `signal`: 取消加载
- `onProgress`: 接收 capabilities、manifest、model、session、fallback、ready 等阶段
- `ort.wasm`: WASM 路径与线程选项

当 `phase: "model"` 且 `status: "progress"` 时，事件中的 `loadedBytes` 和可选的 `totalBytes` 仅表示模型网络下载字节，不是完整初始化进度；它们不包含完整性校验或 ONNX Runtime Session 创建。响应没有 `Content-Length` 时按清单声明的模型字节数提供 `totalBytes`，缓存、内存或自定义二进制模型也可能不产生字节进度。

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

- `detect(image, { threshold, classThresholds, signal, timestampMs, metadata })`: 接收 Blob、CanvasImageSource、`HTMLVideoElement`、单帧 `VideoFrame` 或标准化 raster。
- `dispose()`: 等待已排队操作完成并释放 Worker/session；可重复调用。
- `getCacheEstimate()` / `clearCurrentModelCache()` / `clearAllCache()`：估算本 SDK 缓存、清理当前实例模型缓存键或清理全部本 SDK 模型缓存；释放会话使用 `dispose()`。
- `model`, `runtime`, `capabilities`, `loadTimings`: 实际加载信息。

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

清单将 `preprocessing.doResize` 设为 `false` 时，输入图像的宽和高都不能超过模型输入尺寸；否则会抛出 `INVALID_INPUT`，不会静默裁剪图像。

预处理插值支持 `interpolation: "bilinear"` 和 `interpolation: "bicubic"`。旧式公开
`ModelManifest` 的 `resample` 仅接受 Pillow/Paddle 的 `2`（双线性）和 `3`（双三次），
其中 `3` 会适配为 `bicubic`；未实现的值会以 `INVALID_MANIFEST` 拒绝。未声明插值模式时，
runtime manifest 默认使用双线性。

摄像头权限、视频播放和帧调度由宿主页面负责。建议每次只提交一帧，等待 Promise 完成后再提交下一帧；停止媒体时取消未完成请求并调用 `dispose()`。

## 其他导出

`probePPDetectionCapabilities()`、`ModelManager`、`clearModelCache()`、`parseModelManifest()`、`PPDetectionError`，以及公开 TypeScript 类型。界面可按稳定的 `error.code` 本地化。

没有活动检测器时，可创建 `ModelManager` 并使用 `getCacheEstimate({ id, version })` 与
`clearCurrentModelCache({ id, version })`，按当前实际清单的模型身份统计或清理该模型的全部变体、来源。
带模型身份的重载、`ModelCache.scope` 和 `list()` 从 0.2.0 起提供。
不传身份的 `getCacheEstimate()` 返回全部本 SDK 缓存；字节数按缓存键去重，不是整个站点的配额或进程内存。
自定义缓存需实现可选的 `list()` 才能按模型操作，否则返回 `CAPABILITY_UNSUPPORTED`，不会扩大清理范围。

同一 JavaScript 执行环境内，共享 IndexedDB 数据库的管理器会同步失效代次并串行处理缓存操作。
清理前开始的下载即使后来完成也不会写回；清理后新加载正常写入。模块级 `clearModelCache()` 同时清理
该范围内活动实例的缓存副本，但不释放它们的推理会话。Demo 会先取消并等待操作、释放会话，再清理和刷新容量。
不同标签页或 Worker 的并发加载不在跨执行环境协调保证范围内。

`loadTimings.modelSource` 区分 `network`、`cache`、`memory`。`runtime.runtimeVersion` 与 `runtime.environment` 记录实际 ORT 版本和当前环境，运行结果保留当次后端快照；这些可选字段从 0.2.0 起提供，具体计时语义见[性能](performance.md)。

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
