# Custom models

[中文](../zh-CN/custom-models.md)

A fine-tuned model needs a schemaVersion 1 manifest and must preserve the PP-Detection input, four outputs, and label contract. Every variant declares its URL, byte count, SHA-256, opset, precision, compatible backends, and validation status.

Load a manifest by URL, or provide the validated manifest and ONNX bytes together:

```ts
import { createPPDetection, parseModelManifest } from "web-sdk-pp-detection";

const manifest = parseModelManifest(await (await fetch("/models/custom/manifest.json")).json());
const data = await (await fetch("/models/custom/model-fp32.onnx")).arrayBuffer();
const detector = await createPPDetection({
  model: { manifest, data },
  backend: "wasm",
  precision: "fp32"
});
await detector.dispose();
```

Set a custom manifest's `preprocessing.interpolation` to `bilinear` or `bicubic`.
For legacy `resample`, only `2` (bilinear) and `3` (bicubic) are supported; other Pillow
interpolation enums are rejected instead of silently selecting a different algorithm.

`{ manifest, data }` still verifies SHA-256 and cannot bypass integrity checks. A custom graph that changes output semantics, query count, mask shape, or label mapping needs an SDK adaptation; merely loading in ONNX Runtime does not prove compatibility.

Production deployments should use immutable version URLs, correct CORS, HTTPS, long-lived caching, and a retained validation report for each release.
