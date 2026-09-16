# PP-YOLO Tiny 320 (0.1.1)

This version reuses the immutable FP32 sources from 0.1.0 and adds the quality-gated FP16 variant. FP16 is 2,357,376 bytes with SHA-256 `331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc`, 47.743% smaller than FP32. `Exp.0`, `Exp.2`, and `Exp.4` remain FP32; the input and output contract is unchanged.

Across three fixed 64-image runs on both WASM and WebGPU, the worst FP16 AP change was -0.174649 points and the minimum one-to-one detection retention was 99.5192%. W8A32 missed the AP gate at -0.537364 points, remains labs-only, and is absent from this manifest and the stable download directory.

Desktop WASM/WebGPU, main/Worker, pre-cancellation, recovery, repeated disposal, and cache clearing were verified. Evidence is limited to the fixed subset on Windows 11, Chromium 153, and ORT Web 1.27.0; it is not full COCO mAP and makes no mobile, NPU, or universal speed claim. SDK/npm remains 0.4.0.

PaddleDetection attribution, license, and the FP32 conversion record are inherited from 0.1.0. See `reports/evaluation/2026-09-16-tiny-precision/` and `reports/distribution/2026-09-16-tiny-precision/`.
