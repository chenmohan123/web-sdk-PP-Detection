# 快速开始

[English](../en/quick-start.md)

安装 `web-sdk-pp-detection@0.3.1` 后，浏览器会在第一次创建检测器时探测能力、下载外部清单与模型、校验 SHA-256，并创建 ONNX Runtime 会话。npm 包不内置清单或 ONNX 权重，必须显式传入 `model` 或 `manifest`。当前 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 均提供 FP32、FP16、W8A32 稳定变体；默认组合为 PicoDet、ModelScope、FP32。

页面至少需要一个单图文件输入：

```ts
import { createPPDetection, PPDetectionError } from "web-sdk-pp-detection";

const manifestUrl =
  "https://modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/88d23d254e9cc2c98874ae8bd8a7c092612e65f6/picodet-l-320/1.0.2/manifest.json";

export async function detectOne(file: File, signal: AbortSignal): Promise<void> {
  const detector = await createPPDetection({
    model: manifestUrl,
    source: "modelscope",
    precision: "fp32",
    backend: "auto",
    allowFallback: true,
    signal,
    onProgress: (event) => console.log(event.phase, event.status)
  });
  try {
    const result = await detector.detect(file, {
      threshold: 0.5,
      classThresholds: {
        person: 0.6,
        car: 0.5
      },
      signal
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof PPDetectionError) console.error(error.code, error.message);
    else throw error;
  } finally {
    await detector.dispose();
  }
}
```

如需 PP-YOLOE、Hugging Face、FP16 或 W8A32，切换固定清单、`source` 和 `precision` 即可；W8A32 对应 `precision: "int8"`。完整的两模型 × 三精度选择、取消与画布绘制见[六变体示例](../../examples/model-variants/README.md)。显式来源失败不会静默切换到另一个 Hub。

`classThresholds` 按 manifest 标签名称覆盖目标检测置信度过滤阈值，未配置的类别回退到全局 `threshold`。例如 PicoDet 的 `person` 和 `car` 可以使用不同阈值。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。

检测结果包含原图坐标系下的目标 `box`、类别和置信度，也包含加载/推理耗时、实际后端、精度和回退记录。生产页面应展示加载状态、允许取消，并在页面卸载时调用 `dispose()`。

## 摄像头与视频

浏览器页面负责摄像头权限和视频帧调度，SDK 负责单帧解码与推理：

```ts
declare const video: HTMLVideoElement;
declare const detector: import("web-sdk-pp-detection").PPDetectionDetector;

export async function detectVideoFrame(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  video.srcObject = stream;
  await video.play();
  try {
    const result = await detector.detect(video, { timestampMs: performance.now() });
    console.log(result.frame?.timestampMs, result.detections);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
```

实时场景应等待上一帧完成后再提交下一帧，并在页面隐藏、播放结束或权限撤销时停止调度。

六变体、CDN、Vanilla Vite、React、Vue 和微信 H5/WebView 的完整用法在 [`examples/`](../../examples/) 中。

当前工作区维护版本另有 `download.timeoutMs`、`download.idleTimeoutMs` 和 `download.maxRetries`；这些选项尚未随 npm `0.3.1` 发布，因此上面的公开包代码不使用它们。
