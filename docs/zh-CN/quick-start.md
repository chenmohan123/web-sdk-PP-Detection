# 快速开始

[English](../en/quick-start.md)

安装 `web-sdk-pp-detection` 后，浏览器会在第一次创建检测器时探测能力、下载清单与模型、校验 SHA-256，并创建 ONNX Runtime 会话。当前仓库默认 manifest 仍处于 blocked 状态，需传入已验证的 runtime manifest 或自定义模型清单；省略 `model` 会返回 `INVALID_MANIFEST`。默认 `backend: "auto"` 和 `precision: "auto"` 选择清单中的可用稳定变体；`allowFallback` 默认关闭，需要显式设置为 `true` 才允许会话失败后切换到下一后端。

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
        formula: 0.4,
        table: 0.55,
        text: 0.6
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

`classThresholds` 按 manifest 标签名称覆盖置信度过滤阈值，未配置的类别回退到 `threshold`。全局 `threshold` 仍用于 mask 二值化和多边形提取。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。

检测结果包含原图坐标系下的 `box`、`polygon`、类别、置信度与阅读顺序，也包含加载/推理耗时、实际后端、精度和回退记录。生产页面应展示加载状态、允许取消，并在页面卸载时调用 `dispose()`。

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
