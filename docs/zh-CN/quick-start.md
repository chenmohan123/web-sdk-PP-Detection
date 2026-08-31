# 快速开始

[English](../en/quick-start.md)

安装 `web-sdk-pp-detection` 后，浏览器会在第一次创建检测器时探测能力、下载清单与模型、校验 SHA-256，并创建 ONNX Runtime 会话。当前仓库默认内置 PicoDet 1.0.1 FP32 stable manifest；也可以传入经过验证的 runtime manifest 或自定义模型清单。默认 `backend: "auto"` 优先 WebGPU，`precision: "auto"` 选择清单中的可用稳定变体；`allowFallback` 默认关闭，需要显式设置为 `true` 才允许失败后切换到下一后端。

页面至少需要一个单图文件输入：

```ts
import { createPPDetection, PPDetectionError } from "web-sdk-pp-detection";

export async function detectOne(file: File): Promise<void> {
  const detector = await createPPDetection({
    model: "https://models.example.com/pp-detection/manifest.json",
    onProgress: (event) => console.log(event.phase, event.status)
  });
  try {
    const result = await detector.detect(file, {
      threshold: 0.5,
      classThresholds: {
        person: 0.6,
        car: 0.5
      }
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

CDN、Vanilla Vite、React、Vue 和微信 H5/WebView 的完整用法在 [`examples/`](../../examples/) 中。
