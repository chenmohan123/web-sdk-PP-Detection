# API

[English](../en/api.md)

所有稳定入口都从包根路径导出，不要导入 `src/` 或其他内部文件。

## `createPPDetection(options?)`

返回 `Promise<PPDetectionDetector>`。常用选项：

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`；默认清单不包含 INT8
- `allowFallback`: 会话失败时是否尝试下一有效候选；默认 `false`。只有显式设置为 `true` 才会回退，且不会改写清单中不存在的后端/精度组合
- `model`: 清单 URL、清单对象或 `{ manifest, data }`
- `cache`: 是否使用模型缓存
- `signal`: 取消加载
- `onProgress`: 接收 capabilities、manifest、model、session、fallback、ready 等阶段
- `ort.wasm`: WASM 路径与线程选项

当 `phase: "model"` 且 `status: "progress"` 时，事件中的 `loadedBytes` 和可选的 `totalBytes` 仅表示模型网络下载字节，不是完整初始化进度；它们不包含完整性校验或 ONNX Runtime Session 创建。响应没有 `Content-Length` 时 `totalBytes` 可能缺失，缓存、内存或自定义二进制模型也可能不产生字节进度。

默认 PicoDet manifest 当前仍为 blocked；仓库虽有本地 FP32 ONNX 候选和一次 WASM smoke test，但尚无可下载的 stable 默认资产。`webgpu`、`wasm`（CPU）以及 `fp32`、`fp16`、`int8`、`int4`、`fp8` 的可用组合必须以 manifest 变体和运行时探测为准。清单中不存在的显式组合会抛出 `CAPABILITY_UNSUPPORTED`；`allowFallback` 只处理有效候选的运行时失败，不会改写无效组合。Demo 仅在“自动后端 + 自动精度”时允许回退，任何手动后端或精度选择都会严格执行。原始模型是 float32，不支持 FP64 推理。

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

- `detect(image, { threshold, classThresholds, signal, timestampMs, metadata })`: 接收 Blob、CanvasImageSource、`HTMLVideoElement`、单帧 `VideoFrame` 或标准化 raster。
- `dispose()`: 等待已排队操作完成并释放 Worker/session；可重复调用。
- `listModelCache()` / `clearModelCache()`: 查看或清除该检测器的模型缓存。
- `model`, `runtime`, `capabilities`, `loadTimings`: 实际加载信息。

```ts
import type { PPDetectionDetector } from "web-sdk-pp-detection";

declare const detector: PPDetectionDetector;
declare const file: Blob;

const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
```

`precision: "auto"` 选择清单变体顺序中的第一个可用稳定精度；当前默认 PicoDet 只保留 FP32 证据，因此不会猜测 FP16。`classThresholds` 按 manifest 标签名称覆盖置信度过滤阈值，未配置的类别回退到 `threshold`。全局 `threshold` 仍用于 mask 二值化和多边形提取。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。

清单将 `preprocessing.doResize` 设为 `false` 时，输入图像的宽和高都不能超过模型输入尺寸；否则会抛出 `INVALID_INPUT`，不会静默裁剪图像。

摄像头权限、视频播放和帧调度由宿主页面负责。建议每次只提交一帧，等待 Promise 完成后再提交下一帧；停止媒体时取消未完成请求并调用 `dispose()`。

## 其他导出

`probePPDetectionCapabilities()`、`listModelCache()`、`clearModelCache()`、`parseModelManifest()`、`PPDetectionError`、默认清单/WASM URL，以及所有公开 TypeScript 类型。错误消息保持英文稳定，界面可按 `error.code` 本地化。
