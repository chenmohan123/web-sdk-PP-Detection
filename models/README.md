# 模型文件

## 当前稳定范围（2026-09-14）

SDK `web-sdk-pp-detection@0.4.0` 提供 PicoDet-L 320 与 PP-YOLOE+ S/M/L/X 640，共 15 个稳定变体。权重按需从外部固定来源下载，npm 包不内置 ONNX。大小单位为字节。

| 模型            | 版本  |        FP32 |        FP16 |      W8A32 | 清单                                        |
| --------------- | ----- | ----------: | ----------: | ---------: | ------------------------------------------- |
| PicoDet-L 320   | 1.0.2 |  23,243,834 |  14,813,981 |  6,117,685 | [PicoDet](pp-detection/1.0.2/manifest.json) |
| PP-YOLOE+ S 640 | 0.1.1 |  31,954,220 |  16,054,567 |  8,225,467 | [S](ppyoloe-plus-s-640/0.1.1/manifest.json) |
| PP-YOLOE+ M 640 | 0.1.1 |  94,022,904 |  47,104,975 | 23,818,631 | [M](ppyoloe-plus-m-640/0.1.1/manifest.json) |
| PP-YOLOE+ L 640 | 0.1.1 | 209,181,400 | 104,700,181 | 52,698,311 | [L](ppyoloe-plus-l-640/0.1.1/manifest.json) |
| PP-YOLOE+ X 640 | 0.1.1 | 394,163,636 | 197,207,187 | 99,048,805 | [X](ppyoloe-plus-x-640/0.1.1/manifest.json) |

全部默认 ModelScope、FP32，并允许显式选择 Hugging Face；显式来源失败不会静默换源。各清单固定不可变来源 revision、路径、大小与 SHA-256。Demo 默认 PicoDet。Git LFS pointer 不是模型本体。

W8A32 通过 SDK `precision: "int8"` 选择，表示权重 INT8 存储、激活和计算 FP32。FP16 保留敏感算子 FP32。文件体积不代表内存峰值或必然加速。

M/L/X 的三精度证据覆盖 2026-09-14 Windows 11 / Chromium 153 / ORT Web 1.27.0 桌面固定 64 图三轮验证，见[质量报告](../reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md)。S 与 PicoDet 的三精度证据见[原评测](../reports/evaluation/2026-09-12-precision-variants/README.md)。小米 15 历史实测仅覆盖原 FP32，不包含新增 M/L/X 精度；不据此宣称通用手机或微信 WebView 兼容。

四规格模型卡随附 Apache-2.0 LICENSE、官方权重来源和转换说明。来源平台不改变上游许可；COCO 图片仍遵守各自许可。[第三方声明](../THIRD_PARTY_NOTICES.md)及[本轮分发证据](../reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md)记录完整边界。
