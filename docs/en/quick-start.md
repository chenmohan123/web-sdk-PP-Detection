# Quick start

[中文](../zh-CN/quick-start.md)

安装 `web-sdk-pp-detection@0.3.2` 后，浏览器会在第一次创建检测器时探测能力、下载外部清单与模型、校验 SHA-256，并创建 ONNX Runtime 会话。npm 包不内置清单或 ONNX 权重，必须显式传入 `model` 或 `manifest`。当前 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 均提供 FP32、FP16、W8A32 稳定变体；默认组合为 PicoDet、ModelScope、FP32。

Start with a single-image file input:

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

`classThresholds` overrides object-detection confidence filtering for matching manifest label names and falls back to the global `threshold` for unspecified classes. For example, PicoDet can use separate thresholds for `person` and `car`. Unknown class names and values outside `0` through `1` are rejected.

The result includes original-image coordinates for each detected object box, category, and score. It also reports loading/inference timings, the actual backend and precision, and fallback records. Production pages should expose loading state and cancellation and call `dispose()` during page teardown.

## Camera and video

The page owns camera permission and video-frame pacing while the SDK processes one frame at a time:

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

Await each frame before submitting the next one, and stop scheduling when the page is hidden, playback ends, or permission is revoked.

六变体、CDN、Vanilla Vite、React、Vue 和微信 H5/WebView 的完整用法在 [`examples/`](../../examples/) 中。

0.3.2 提供 `download.timeoutMs`、`download.idleTimeoutMs` 和 `download.maxRetries`；省略配置时使用每次请求 180 秒、无新增字节 30 秒、最多重试 2 次的默认策略。
