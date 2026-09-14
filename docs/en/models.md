# Models and precision

> 2026-09-15: The release now has 13 specifications and 23 stable variants. New PicoDet XS/S/M 320/416 and L 416/640 manifests use 1.0.0; L320 remains 1.0.2.

[中文](../zh-CN/models.md)

## Current stable manifests (2026-09-15)

The manifests provide 13 specifications and 23 stable variants. The eight new PicoDet specifications provide FP32 only; PicoDet-L 320 and the four PP-YOLOE+ specifications provide FP32, FP16, and W8A32. Manifests default to ModelScope and FP32 and allow explicit ModelScope or Hugging Face selection. The npm package contains neither manifests nor ONNX weights.

| Model                | Version |         FP32 |      FP16 |    W8A32 |
| -------------------- | ------- | -----------: | --------: | -------: |
| PicoDet-L-320 LCNet  | 1.0.2   |     23.24 MB |  14.81 MB |  6.12 MB |
| PicoDet-XS-320 LCNet | 1.0.0   |  2,886,024 B |         — |        — |
| PicoDet-XS-416 LCNet | 1.0.0   |  2,903,707 B |         — |        — |
| PicoDet-S-320 LCNet  | 1.0.0   |  4,807,906 B |         — |        — |
| PicoDet-S-416 LCNet  | 1.0.0   |  4,825,589 B |         — |        — |
| PicoDet-M-320 LCNet  | 1.0.0   | 13,905,160 B |         — |        — |
| PicoDet-M-416 LCNet  | 1.0.0   | 13,922,843 B |         — |        — |
| PicoDet-L-416 LCNet  | 1.0.0   | 23,261,512 B |         — |        — |
| PicoDet-L-640 LCNet  | 1.0.0   | 23,320,381 B |         — |        — |
| PP-YOLOE+ S 640      | 0.1.1   |     31.95 MB |  16.05 MB |  8.23 MB |
| PP-YOLOE+ M 640      | 0.1.1   |     94.02 MB |  47.10 MB | 23.82 MB |
| PP-YOLOE+ L 640      | 0.1.1   |    209.18 MB | 104.70 MB | 52.70 MB |
| PP-YOLOE+ X 640      | 0.1.1   |    394.16 MB | 197.21 MB | 99.05 MB |

- PicoDet manifest: [`models/pp-detection/1.0.2/manifest.json`](../../models/pp-detection/1.0.2/manifest.json)
- New PicoDet manifests: `models/pp-detection/picodet-<size>-<res>/manifest.json`; see the [model asset index](../../models/pp-detection/README.md)
- PP-YOLOE+ S manifest: [`models/ppyoloe-plus-s-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json)
- PP-YOLOE+ M manifest: [`models/ppyoloe-plus-m-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-m-640/0.1.1/manifest.json)
- PP-YOLOE+ L manifest: [`models/ppyoloe-plus-l-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-l-640/0.1.1/manifest.json)
- PP-YOLOE+ X manifest: [`models/ppyoloe-plus-x-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-x-640/0.1.1/manifest.json)

Each manifest pins source revisions, paths, byte counts, and SHA-256 digests. An explicitly selected source never silently switches; only `source: "auto"` may try another declared source.

## Precision semantics

SDK precision values `"fp32"` and `"fp16"` select their floating-point variants, while `precision: "int8"` selects W8A32. W8A32 stores weights as INT8 but keeps activations and convolution computation in FP32. A smaller model file does not imply a proportional runtime-memory reduction. FP16 keeps sensitive operators in FP32, and input/output contracts remain FP32/INT32.

All 23 variants declare WASM and WebGPU support. Runtime capability probing still applies. An explicitly selected unsupported combination returns `CAPABILITY_UNSUPPORTED` without silently replacing the precision. `backend: "auto"` tries another valid backend after a session or inference failure only with `allowFallback: true`.

The six new M/L/X FP16/W8A32 variants (evaluated alongside three existing FP32 controls, nine variants in total) were checked over three desktop WASM/WebGPU runs on a fixed 64-image set. Relative to the matching FP32 model, AP loss is at most 0.5 points and at least 95% of FP32 detections are retained at score >= 0.5 and same-class IoU >= 0.5. IoU >= 0.99 is diagnostic only. See the [current quality report](../../reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md). Evidence for S and PicoDet is in the [earlier precision report](../../reports/evaluation/2026-09-12-precision-variants/README.md). These fixed-subset results are not full COCO mAP and do not establish universal speedups or peak-memory reductions.

Xiaomi 15 evidence covers only the original FP32 model, so it does not establish mobile compatibility for the new precisions or M/L/X. Upstream models come from PaddleDetection; model cards, the [distribution evidence](../../reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md), and [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) record sources, licenses, and SHA-256 identities.
