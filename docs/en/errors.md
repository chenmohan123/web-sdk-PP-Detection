# Error codes

[中文](../zh-CN/errors.md)

Runtime messages remain English. Localize application UI using the stable `PPDetectionError.code`. The following table is maintained from the single source `docs/error-codes.json`:

| Code                       | Meaning                                                                | Recommended action                                                              |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `CAPABILITY_UNSUPPORTED`   | The browser lacks the required WebGPU or WASM capability.              | Upgrade the browser, select WASM, or check the secure context.                  |
| `INVALID_INPUT`            | The image, video frame, or other input format is invalid.              | Use a valid Blob, Canvas, ImageData, HTMLVideoElement, or VideoFrame.           |
| `INVALID_MANIFEST`         | The model manifest has an invalid schema, version, or field.           | Fix the JSON against the manifest contract and check minSdkVersion.             |
| `MODEL_DOWNLOAD_FAILED`    | Downloading the model or manifest failed.                              | Check the URL, network, HTTPS, CORS, and response status.                       |
| `MODEL_INTEGRITY_FAILED`   | The model size or SHA-256 does not match the manifest.                 | Clear the cache and download again from a trusted immutable URL.                |
| `MODEL_INCOMPATIBLE`       | No model variant matches the selected backend and precision.           | Allow fallback or provide a compatible FP32/FP16 variant.                       |
| `MODEL_SOURCE_UNAVAILABLE` | The declared model source is unavailable or has no downloadable asset. | Check the source kind, revision, URL, CORS, and manifest.                       |
| `SESSION_CREATE_FAILED`    | Creating the ONNX Runtime session failed.                              | Check model operators and WASM asset paths, then allow fallback.                |
| `DISPOSED`                 | The detector has been disposed and cannot run more operations.         | Create a new detector and dispose it once at the end of its lifecycle.          |
| `INFERENCE_FAILED`         | Inference failed, or an operation used a disposed detector.            | Inspect details, input dimensions, and lifecycle; recreate the detector.        |
| `OUT_OF_MEMORY`            | The browser ran out of memory.                                         | Dispose old detectors, close other tabs, use FP16, or run on desktop.           |
| `ABORTED`                  | Loading or detection was cancelled by an AbortSignal.                  | Retry only when needed and create a new AbortController for the next operation. |

```ts
import { PPDetectionError } from "web-sdk-pp-detection";

export function errorLabel(error: unknown): string {
  if (!(error instanceof PPDetectionError)) return "UNKNOWN";
  return `${error.code}: ${error.message}`;
}
```
