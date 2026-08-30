# web-sdk-pp-detection

[English](#english) | [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)

基于 ONNX Runtime Web 的浏览器端 PP-Detection 版面分析 SDK，支持 PC、移动端与各类 H5 页面。

## 安装

```bash
pnpm add web-sdk-pp-detection
```

也可以使用 `npm install web-sdk-pp-detection`。

## 快速开始

```ts
import { createPPDetection } from "web-sdk-pp-detection";

const detector = await createPPDetection({
  model: "https://models.example.com/pp-detection/manifest.json",
  backend: "auto",
  precision: "auto"
});
const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
console.log(result.detections, result.runtime, result.timings);
await detector.dispose();
```

`classThresholds` 按 manifest 标签名称覆盖置信度过滤阈值，未配置的类别回退到 `threshold`。全局 `threshold` 仍用于 mask 二值化和多边形提取。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。

当前发布版本内置 PicoDet 1.0.1 FP32 stable manifest；使用默认模型时可以省略 `model`。自定义模型仍应传入经过验证的 runtime manifest 或清单对象。

模型初始化耗时可以通过 `detector.loadTimings` 查看。`totalMs` 是初始化总耗时，同时提供 `modelDownloadMs`（网络下载）、`modelCacheReadMs`（缓存读取）、`integrityMs`（SHA-256 完整性校验）和 `sessionMs`（ONNX Runtime Session 创建）。发布版本内置 PicoDet 1.0.1 FP32 stable manifest；使用自定义模型时请传入已验证的 runtime manifest 或清单对象。

## 运行后端与精度

- `backend: "auto"` 优先使用 WebGPU；只有显式设置 `allowFallback: true` 时，WebGPU 会话失败才会尝试 WASM（CPU）。也可手动指定 `"webgpu"` 或 `"wasm"`。
- `precision: "auto"` 选择清单中可用的默认稳定精度；当前默认 PicoDet 仅验证 FP32，因此不会臆测切换到 FP16。已验证其他精度时可手动指定 `"fp16"`、`"int8"` 等。
- 默认 PicoDet 1.0.1 FP32 已发布可下载的 stable ONNX 资产，并通过 Linux WASM 与 Windows NVIDIA WebGPU 七张 fixture 验证；FP16、INT8、INT4 和 FP8 仍需独立证据。
- 使用默认模型时，显式请求清单中未声明的组合会抛出 `CAPABILITY_UNSUPPORTED`，不会改写无效组合；自定义清单可在单独验证后声明其他组合。上游模型是 float32，不支持 FP64；FP32 约为 FP16 两倍大小并可能更慢、更占显存。
- `detect` 可接收图片 Blob/File、Canvas/ImageData、`HTMLVideoElement` 或单帧 `VideoFrame`。摄像头和视频播放的权限、帧率控制由宿主页面负责；每次提交一帧后应等待 Promise 完成，并在停止媒体时调用 `dispose()`。

## 自定义模型

通过 `model` 传入微调模型的 Custom manifest URL 或 manifest 对象。自定义 manifest 必须遵循仓库中的模型契约，并为每个模型文件提供大小、SHA-256、精度及后端兼容信息。

```ts
const detector = await createPPDetection({
  model: "https://models.example.com/pp-detection/manifest.json"
});
```

## 资源管理

模型加载进度通过 `onProgress` 回调提供。`phase: "model"`、`status: "progress"` 事件中的 `loadedBytes` 和可选的 `totalBytes` 仅表示网络下载字节，不代表完整初始化百分比，也不包含完整性校验或 Session 创建。响应没有 `Content-Length` 时 `totalBytes` 可能缺失，缓存、内存或自定义二进制模型也可能不产生字节进度。可捕获结构化的 `PPDetectionError` 并读取 `code` 与 `details`。SDK 支持模型缓存；可以通过 detector 的缓存方法查询或清理。使用结束后必须调用 `dispose()` 释放 Worker、ONNX Runtime session 与 GPU/CPU 资源。

## 微信环境

支持微信公众号页面以及微信内嵌浏览器中的 H5/WebView 集成。当前不宣称支持 native Mini Program 原生小程序直接推理；原生小程序需要通过 WebView 承载 H5 页面或使用服务端推理。

## 完整文档

- [中文文档](https://github.com/chenmohan123/web-sdk-PP-Detection#readme)
- [English documentation](https://github.com/chenmohan123/web-sdk-PP-Detection/blob/main/README.en.md)
- [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)
- [示例目录](https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/examples)

## English

A browser-first PP-Detection document layout analysis SDK powered by ONNX Runtime Web for desktop, mobile, and H5 pages.

### Installation

```bash
pnpm add web-sdk-pp-detection
```

`npm install web-sdk-pp-detection` is also supported.

### Quick start

```ts
import { createPPDetection } from "web-sdk-pp-detection";

const detector = await createPPDetection({
  model: "https://models.example.com/pp-detection/manifest.json",
  backend: "auto",
  precision: "auto"
});
const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
console.log(result.detections, result.runtime, result.timings);
await detector.dispose();
```

`classThresholds` overrides confidence filtering for matching manifest label names and falls back to `threshold` for unspecified classes. The global `threshold` still controls mask binarization and polygon extraction. Unknown class names and values outside `0` through `1` are rejected.

The release includes a built-in PicoDet 1.0.1 FP32 stable manifest, so `model` may be omitted for the default model. Pass a verified runtime or custom manifest when using another model.

Detailed initialization timings are available through `detector.loadTimings`. `totalMs` is the full initialization duration. The additive fields `modelDownloadMs`, `modelCacheReadMs`, `integrityMs`, and `sessionMs` separate network download, cache reads, SHA-256 verification, and Session creation. The release includes the PicoDet 1.0.1 FP32 stable manifest; pass a verified runtime or custom model manifest when using another model.

### Backend and precision

- `backend: "auto"` prefers WebGPU; only `allowFallback: true` permits a failed WebGPU session to try WASM (CPU). Use `"webgpu"` or `"wasm"` for an explicit choice.
- `precision: "auto"` selects the available default stable precision from the manifest. The default PicoDet 1.0.1 validates FP32 only, so the SDK does not guess an FP16 switch. When another precision has been validated, select it explicitly with `"fp16"`, `"int8"`, and so on.
- The default PicoDet 1.0.1 FP32 variant is a downloadable stable ONNX asset and has passed seven-fixture validation on Linux WASM and Windows NVIDIA WebGPU. FP16, INT8, INT4, and FP8 still require independent release-source and backend evidence.
- `detect` accepts image Blob/File, Canvas/ImageData, `HTMLVideoElement`, or a single `VideoFrame`. Hosts own camera/video permissions and frame pacing; await each frame Promise and call `dispose()` when media stops.
- Explicit pairs absent from the default manifest throw `CAPABILITY_UNSUPPORTED` instead of rewriting an invalid pair. The upstream model is float32, not FP64; FP64 inference is unsupported. FP32 is about twice the size of FP16 and may be slower or use more GPU memory.

### Custom models

Pass a fine-tuned model's Custom manifest URL or manifest object through `model`. Each manifest variant must declare its byte size, SHA-256 digest, precision, and compatible backends.

```ts
const detector = await createPPDetection({
  model: "https://models.example.com/pp-detection/manifest.json"
});
```

### Resource management

Use `onProgress` for model loading progress. On `phase: "model"`, `status: "progress"` events, `loadedBytes` and the optional `totalBytes` describe network-transfer bytes only; they are not an overall initialization percentage and exclude integrity verification and Session creation. `totalBytes` can be absent without a `Content-Length` response header, while cache, memory, or custom binary model sources may emit no byte progress. Structured failures are exposed as `PPDetectionError` with `code` and `details`. Model cache entries can be listed or cleared through the detector. Always call `dispose()` when finished to release the Worker, ONNX Runtime session, and GPU/CPU resources.

### WeChat environments

WeChat official-account pages and other H5/WebView integrations are supported. Native Mini Program inference is not claimed; a native Mini Program should host the H5 experience in a WebView or use server-side inference.

### Documentation

- [Chinese documentation](https://github.com/chenmohan123/web-sdk-PP-Detection#readme)
- [English documentation](https://github.com/chenmohan123/web-sdk-PP-Detection/blob/main/README.en.md)
- [Live Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/)
- [Examples](https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/examples)

Apache-2.0
