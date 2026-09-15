# Models and precision

> 2026-09-15: 14 specifications and 38 stable variants, including Tiny 320 FP32 0.1.0. PicoDet adds 14 qualified FP16/W8A32 variants at version 1.0.1; L-320 remains at 1.0.2.

[中文](../zh-CN/models.md)

## Current stable manifests (2026-09-15)

2026-09-15: 14 specifications and 38 stable variants, including Tiny 320 FP32 0.1.0. PicoDet adds 14 qualified FP16/W8A32 variants at version 1.0.1; L-320 remains at 1.0.2.Defaults are FP32 and ModelScope, with explicit Hugging Face selection available. Precisions that failed the recognition gate remain labs.

| Model                | Version |      FP32 |      FP16 |    W8A32 |
| -------------------- | ------- | --------: | --------: | -------: |
| PicoDet-L-320 LCNet  | 1.0.2   |  23.24 MB |  14.81 MB |  6.12 MB |
| PicoDet-XS-320 LCNet | 1.0.1   |   2.89 MB |   1.86 MB |        — |
| PicoDet-XS-416 LCNet | 1.0.1   |   2.90 MB |   1.88 MB |        — |
| PicoDet-S-320 LCNet  | 1.0.1   |   4.81 MB |   3.08 MB |  1.38 MB |
| PicoDet-S-416 LCNet  | 1.0.1   |   4.83 MB |   3.10 MB |  1.40 MB |
| PicoDet-M-320 LCNet  | 1.0.1   |  13.91 MB |   8.87 MB |  3.74 MB |
| PicoDet-M-416 LCNet  | 1.0.1   |  13.92 MB |   8.89 MB |  3.75 MB |
| PicoDet-L-416 LCNet  | 1.0.1   |  23.26 MB |  14.84 MB |  6.14 MB |
| PicoDet-L-640 LCNet  | 1.0.1   |  23.32 MB |  14.87 MB |  6.19 MB |
| PP-YOLOE+ S 640      | 0.1.1   |  31.95 MB |  16.05 MB |  8.23 MB |
| PP-YOLOE+ M 640      | 0.1.1   |  94.02 MB |  47.10 MB | 23.82 MB |
| PP-YOLOE+ L 640      | 0.1.1   | 209.18 MB | 104.70 MB | 52.70 MB |
| PP-YOLOE+ X 640      | 0.1.1   | 394.16 MB | 197.21 MB | 99.05 MB |
| PP-YOLO Tiny 320     | 0.1.0   |   4.51 MB |         — |        — |

- PicoDet manifest: [`models/pp-detection/1.0.2/manifest.json`](../../models/pp-detection/1.0.2/manifest.json)
- New PicoDet manifests: `models/pp-detection/picodet-<size>-<res>/1.0.1/manifest.json`; see the [model asset index](../../models/pp-detection/README.md)
- PP-YOLOE+ S manifest: [`models/ppyoloe-plus-s-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json)
- PP-YOLOE+ M manifest: [`models/ppyoloe-plus-m-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-m-640/0.1.1/manifest.json)
- PP-YOLOE+ L manifest: [`models/ppyoloe-plus-l-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-l-640/0.1.1/manifest.json)
- PP-YOLOE+ X manifest: [`models/ppyoloe-plus-x-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-x-640/0.1.1/manifest.json)

Each manifest pins source revisions, paths, byte counts, and SHA-256 digests. An explicitly selected source never silently switches; only `source: "auto"` may try another declared source.

## Precision semantics

SDK precision values `"fp32"` and `"fp16"` select their floating-point variants, while `precision: "int8"` selects W8A32. W8A32 stores weights as INT8 but keeps activations and convolution computation in FP32. A smaller model file does not imply a proportional runtime-memory reduction. FP16 keeps sensitive operators in FP32, and input/output contracts remain FP32/INT32.

All 38 variants declare WASM and WebGPU support. Runtime capability probing still applies. An explicitly selected unsupported combination returns `CAPABILITY_UNSUPPORTED` without silently replacing the precision. `backend: "auto"` tries another valid backend after a session or inference failure only with `allowFallback: true`.

The six new M/L/X FP16/W8A32 variants (evaluated alongside three existing FP32 controls, nine variants in total) were checked over three desktop WASM/WebGPU runs on a fixed 64-image set. Relative to the matching FP32 model, AP loss is at most 0.5 points and at least 95% of FP32 detections are retained at score >= 0.5 and same-class IoU >= 0.5. IoU >= 0.99 is diagnostic only. See the [current quality report](../../reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md). Evidence for S and PicoDet is in the [earlier precision report](../../reports/evaluation/2026-09-12-precision-variants/README.md). These fixed-subset results are not full COCO mAP and do not establish universal speedups or peak-memory reductions.

Xiaomi 15 evidence covers only the original FP32 model, so it does not establish mobile compatibility for the new precisions or M/L/X. Upstream models come from PaddleDetection; model cards, the [distribution evidence](../../reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md), and [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) record sources, licenses, and SHA-256 identities.

新增 PicoDet 精度的三轮结果与未发布候选见[本轮对比](../../reports/evaluation/2026-09-15-picodet-series-precision/README.md)。已发布模型版本以清单表为准，FP32 权重沿用原固定来源。

## PP-YOLO Tiny 320 FP32 (2026-09-15)

Tiny's first stable model version is **0.1.0**, with FP32 only at **4.51 MB**. ModelScope is the default and Hugging Face is optional; SDK/npm remains **0.4.0**. Three desktop runs on the fixed 64-image subset give **22.60 AP** and approximately **47.46/31.54 ms** median warm CPU/GPU inference. Compared with PicoDet-XS-320 FP32 in the same batch, CPU inference is about 28% shorter, the file is about 56% larger, and AP is 1.21 points lower.

The manifest preserves PaddleDetection Apache-2.0 licensing and conversion attribution. These are subset results, not full COCO scores, and do not establish Tiny mobile or NPU compatibility. See the [quality report](../../reports/evaluation/2026-09-15-2d-candidates/README.md), [distribution verification](../../reports/distribution/2026-09-15-ppyolo-tiny/README.md), and [pinned manifest](../../models/ppyolo-tiny-320/0.1.0/manifest.json).
