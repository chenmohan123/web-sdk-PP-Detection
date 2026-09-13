# 0.4.0 release notes

[简体中文](../zh-CN/release-0.4.0.md)

Version: `web-sdk-pp-detection@0.4.0`. Date: 2026-09-13.

## Installation and changes

```bash
pnpm add web-sdk-pp-detection@0.4.0
```

For images containing small objects, explicitly enable `detect(image, { smallObjectEnhancement: true })`. It is disabled by default; ordinary detection retains its whole-image path. The Demo provides a “Small object enhancement (experimental)” checkbox for images. Video and camera detection use the ordinary path.

- Decode once and reuse one session for the whole image and up to four sequential tiles. Project and merge detections in original-image coordinates, then apply global and per-class thresholds.
- `onProgress` reports `completed/total`, with 1–5 inference passes. `smallObjectEnhancement.passes` in the result records the actual count; ordinary results omit this field.
- Supports WASM/WebGPU, main/Worker, cancellation and disposal. Cancellation discards the result. In Worker mode, decoding, cropping and merging still run on the calling thread.
- Enhanced inputs are limited to 16,777,216 pixels. Larger inputs are rejected without automatic resizing. Browser Blob decoding may occur before this check.
- Preprocessing includes cropping; postprocessing includes projection and merging; inference time sums all passes. End-to-end time includes event-loop yields and excludes download, initialization and queueing.

All new options are optional, so existing calls need no changes. See the [API guide](api.md).

## Models, sources and licenses

The six stable variants of [PicoDet 1.0.2](../../models/pp-detection/1.0.2/manifest.json) and [PP-YOLOE 0.1.1](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json) are reused. The Demo defaults to PicoDet, FP32 and ModelScope. Both models default to ModelScope and offer explicit Hugging Face selection. Manifests pin source revisions, byte counts and SHA-256. An explicit source failure never silently switches sources. The npm package contains neither weights nor a default manifest.

| Model           | FP32 bytes | FP16 bytes | W8A32 bytes |
| --------------- | ---------: | ---------: | ----------: |
| PicoDet-L-320   |   23243834 |   14813981 |     6117685 |
| PP-YOLOE+ S 640 |   31954220 |   16054567 |     8225467 |

Models originate from official PaddleDetection weights converted with Paddle2ONNX. The SDK, PaddleDetection and Paddle2ONNX use Apache-2.0; ONNX Runtime Web 1.27.0 uses MIT. See [third-party notices](../../THIRD_PARTY_NOTICES.md).

## Verification and limitations

Small object enhancement remains experimental. The independent high-resolution evaluation did not pass its strict false-positive gate. It can add false positives and latency and does not improve every image; see the [second evaluation](../../reports/evaluation/2026-09-12-tiling-refinement/README.md). Model stability and the maturity of this experimental feature are recorded separately.

On 2026-09-13, Windows, Chromium 153.0.8010.12, ORT 1.27.0 and a physical NVIDIA Blackwell adapter were used for 24 real-model migration checks: two models × three precisions × two backends × main/Worker. Detections matched the frozen experimental pipeline box by box. This verifies migration correctness, not new full COCO mAP or performance benchmarks. See [integration verification](../../reports/verification/2026-09-13-small-objects/README.md).

On the same date, the user reported that testing on a Xiaomi 15 over LAN HTTPS was “basically correct.” The feedback did not enumerate model, precision, actual backend, browser version or all media/cancellation behaviors, so it does not complete the mobile compatibility matrix. Native WeChat Mini Programs do not support this JavaScript/WASM runtime. Multithreaded WASM requires COOP/COEP.

See [release acceptance](../../reports/releases/2026-09-13-0.4.0/README.md) for release checks, remote protection and online verification.
