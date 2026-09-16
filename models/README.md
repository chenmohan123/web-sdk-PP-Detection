# 模型文件

## 当前稳定范围（2026-09-16）

SDK `web-sdk-pp-detection@0.4.0` 提供 PicoDet XS/S/M/L 九个 FP32 规格、PP-YOLOE+ S/M/L/X 640 与 PP-YOLO Tiny 320，共 14 个规格、39 个稳定变体。权重按需从外部固定来源下载，npm 包不内置 ONNX。大小单位为字节。

| 模型             | 版本  |        FP32 |        FP16 |      W8A32 | 清单                                                              |
| ---------------- | ----- | ----------: | ----------: | ---------: | ----------------------------------------------------------------- |
| PicoDet-XS 320   | 1.0.1 |   2,886,024 |   1,863,376 |          — | [PicoDet-XS 320](pp-detection/picodet-xs-320/1.0.1/manifest.json) |
| PicoDet-XS 416   | 1.0.1 |   2,903,707 |   1,875,659 |          — | [PicoDet-XS 416](pp-detection/picodet-xs-416/1.0.1/manifest.json) |
| PicoDet-S 320    | 1.0.1 |   4,807,906 |   3,082,899 |  1,380,421 | [PicoDet-S 320](pp-detection/picodet-s-320/1.0.1/manifest.json)   |
| PicoDet-S 416    | 1.0.1 |   4,825,589 |   3,097,823 |  1,398,104 | [PicoDet-S 416](pp-detection/picodet-s-416/1.0.1/manifest.json)   |
| PicoDet-M 320    | 1.0.1 |  13,905,160 |   8,869,567 |  3,736,832 | [PicoDet-M 320](pp-detection/picodet-m-320/1.0.1/manifest.json)   |
| PicoDet-M 416    | 1.0.1 |  13,922,843 |   8,885,644 |  3,754,515 | [PicoDet-M 416](pp-detection/picodet-m-416/1.0.1/manifest.json)   |
| PicoDet-L 416    | 1.0.1 |  23,261,512 |  14,836,820 |  6,135,363 | [PicoDet-L 416](pp-detection/picodet-l-416/1.0.1/manifest.json)   |
| PicoDet-L 640    | 1.0.1 |  23,320,381 |  14,874,912 |  6,194,232 | [PicoDet-L 640](pp-detection/picodet-l-640/1.0.1/manifest.json)   |
| PicoDet-L 320    | 1.0.2 |  23,243,834 |  14,813,981 |  6,117,685 | [PicoDet](pp-detection/1.0.2/manifest.json)                       |
| PP-YOLOE+ S 640  | 0.1.1 |  31,954,220 |  16,054,567 |  8,225,467 | [S](ppyoloe-plus-s-640/0.1.1/manifest.json)                       |
| PP-YOLOE+ M 640  | 0.1.1 |  94,022,904 |  47,104,975 | 23,818,631 | [M](ppyoloe-plus-m-640/0.1.1/manifest.json)                       |
| PP-YOLOE+ L 640  | 0.1.1 | 209,181,400 | 104,700,181 | 52,698,311 | [L](ppyoloe-plus-l-640/0.1.1/manifest.json)                       |
| PP-YOLOE+ X 640  | 0.1.1 | 394,163,636 | 197,207,187 | 99,048,805 | [X](ppyoloe-plus-x-640/0.1.1/manifest.json)                       |
| PP-YOLO Tiny 320 | 0.1.1 |   4,511,117 |   2,357,376 |          — | [Tiny](ppyolo-tiny-320/0.1.1/manifest.json)                       |

全部默认 ModelScope、FP32，并允许显式选择 Hugging Face；显式来源失败不会静默换源。各清单固定不可变来源 revision、路径、大小与 SHA-256。Demo 默认 PicoDet。Git LFS pointer 不是模型本体。

W8A32 通过 SDK `precision: "int8"` 选择，表示权重 INT8 存储、激活和计算 FP32。FP16 保留敏感算子 FP32。文件体积不代表内存峰值或必然加速。

M/L/X 的三精度证据覆盖 2026-09-14 Windows 11 / Chromium 153 / ORT Web 1.27.0 桌面固定 64 图三轮验证，见[质量报告](../reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md)。S 与 PicoDet 的三精度证据见[原评测](../reports/evaluation/2026-09-12-precision-variants/README.md)。小米 15 历史实测仅覆盖原 FP32，不包含新增 M/L/X 精度；不据此宣称通用手机或微信 WebView 兼容。

四规格模型卡随附 Apache-2.0 LICENSE、官方权重来源和转换说明。来源平台不改变上游许可；COCO 图片仍遵守各自许可。[第三方声明](../THIRD_PARTY_NOTICES.md)及[本轮分发证据](../reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md)记录完整边界。

PicoDet 新增八个 FP16 与六个 W8A32，XS-320/416 的 W8A32 未满足保留率门槛，继续保留 labs。[本轮对比](../reports/evaluation/2026-09-15-picodet-series-precision/README.md)包含质量、耗时及分发证据。

## PP-YOLO Tiny 320 FP32（2026-09-15）

Tiny 首个稳定模型版本为 **0.1.0**，仅提供 FP32，大小 **4.51 MB**；默认 ModelScope，可选 Hugging Face，沿用 SDK/npm **0.4.0**。固定64图桌面三轮结果：子集 AP 为 **22.60**，CPU/GPU 热推理中位数约 **47.46/31.54 ms**。同批次相较 PicoDet-XS-320 FP32，CPU 推理约少28%，文件约大56%，AP低1.21点，适合作为另一种速度与体积取舍。

清单保留 PaddleDetection Apache-2.0 许可和转换归因。上述指标不是全量 COCO 成绩，不扩展 Tiny 的手机或 NPU 兼容声明。见[质量报告](../reports/evaluation/2026-09-15-2d-candidates/README.md)、[分发验证](../reports/distribution/2026-09-15-ppyolo-tiny/README.md)与[固定清单](../models/ppyolo-tiny-320/0.1.0/manifest.json)。

## PP-YOLO Tiny 320 FP16（2026-09-16）

Tiny 0.1.1 复用 0.1.0 的 FP32 固定来源并新增 FP16。FP16 通过固定 64 图、WASM/WebGPU 各三轮质量门槛及双来源×两后端×main/Worker 分发验证；W8A32 的最差 AP 变化超过 0.5 点，仅保留 labs，不在稳定清单中。见[质量证据](../reports/evaluation/2026-09-16-tiny-precision/README.md)与[分发证据](../reports/distribution/2026-09-16-tiny-precision/README.md)。
