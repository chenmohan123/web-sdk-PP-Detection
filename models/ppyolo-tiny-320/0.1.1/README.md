# PP-YOLO Tiny 320（0.1.1）

本版本复用 0.1.0 的 FP32 固定双源权重，并新增通过质量门槛的 FP16。FP16 为 2,357,376 字节，SHA-256 `331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc`，相对 FP32 缩小 47.743%；保留 `Exp.0`、`Exp.2`、`Exp.4` 为 FP32，输入输出契约不变。

固定 64 图、WASM/WebGPU 各三轮结果中，FP16 最差 AP 变化为 -0.174649 个百分点，最低一对一检测保留率为 99.5192%，通过 AP 下降不超过 0.5 点且保留率不低于 95% 的门槛。W8A32 最差 AP 变化为 -0.537364 点，未通过，保留 labs 且不在本清单或稳定下载目录中。

已验证桌面 WASM/WebGPU、main/Worker、预取消、恢复、重复释放和缓存清理。证据仅覆盖 Windows 11 / Chromium 153 / ORT Web 1.27.0 的固定子集，不是完整 COCO mAP，不声明手机、NPU 或普遍加速。SDK/npm 仍为 0.4.0。

上游 PaddleDetection、许可、FP32 转换归因沿用 0.1.0。质量证据见 `reports/evaluation/2026-09-16-tiny-precision/`，分发证据见 `reports/distribution/2026-09-16-tiny-precision/`。
