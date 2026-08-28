# Quick start

[中文](../zh-CN/quick-start.md)

After installing `web-sdk-pp-detection`, the first detector creation probes browser capabilities, downloads the manifest and model, checks SHA-256, and creates an ONNX Runtime session. The repository's default manifest is currently blocked, so pass a verified runtime or custom manifest; omitting `model` returns `INVALID_MANIFEST`. The defaults `backend: "auto"` and `precision: "auto"` select an available stable manifest variant; `allowFallback` is disabled by default and must be set to `true` explicitly before a session failure may try the next backend.

Start with a single-image file input:

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

`classThresholds` overrides confidence filtering for matching manifest label names and falls back to `threshold` for unspecified classes. The global `threshold` still controls mask binarization and polygon extraction. Unknown class names and values outside `0` through `1` are rejected.

The result includes original-image coordinates for each box and polygon, category, score, and reading order. It also reports loading/inference timings, the actual backend and precision, and fallback records. Production pages should expose loading state and cancellation and call `dispose()` during page teardown.

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

Complete CDN, Vanilla Vite, React, Vue, and WeChat H5/WebView integrations live under [`examples/`](../../examples/).
