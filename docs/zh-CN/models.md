# 模型与精度

> 2026-09-15：当前 SDK 共 14 个规格、38 个稳定变体。PicoDet 新增 14 个达标 FP16/W8A32 精度，版本 1.0.1；L-320 保持 1.0.2。

[English](../en/models.md)

## 当前稳定清单（2026-09-15）

2026-09-15：当前 SDK 共 14 个规格、38 个稳定变体。PicoDet 新增 14 个达标 FP16/W8A32 精度，版本 1.0.1；L-320 保持 1.0.2。默认 FP32 和 ModelScope，允许显式选择 Hugging Face；未通过识别门槛的精度保留 labs。

| 模型                 | 版本  |      FP32 |      FP16 |    W8A32 |
| -------------------- | ----- | --------: | --------: | -------: |
| PicoDet-L-320 LCNet  | 1.0.2 |  23.24 MB |  14.81 MB |  6.12 MB |
| PicoDet-XS-320 LCNet | 1.0.1 |   2.89 MB |   1.86 MB |        — |
| PicoDet-XS-416 LCNet | 1.0.1 |   2.90 MB |   1.88 MB |        — |
| PicoDet-S-320 LCNet  | 1.0.1 |   4.81 MB |   3.08 MB |  1.38 MB |
| PicoDet-S-416 LCNet  | 1.0.1 |   4.83 MB |   3.10 MB |  1.40 MB |
| PicoDet-M-320 LCNet  | 1.0.1 |  13.91 MB |   8.87 MB |  3.74 MB |
| PicoDet-M-416 LCNet  | 1.0.1 |  13.92 MB |   8.89 MB |  3.75 MB |
| PicoDet-L-416 LCNet  | 1.0.1 |  23.26 MB |  14.84 MB |  6.14 MB |
| PicoDet-L-640 LCNet  | 1.0.1 |  23.32 MB |  14.87 MB |  6.19 MB |
| PP-YOLOE+ S 640      | 0.1.1 |  31.95 MB |  16.05 MB |  8.23 MB |
| PP-YOLOE+ M 640      | 0.1.1 |  94.02 MB |  47.10 MB | 23.82 MB |
| PP-YOLOE+ L 640      | 0.1.1 | 209.18 MB | 104.70 MB | 52.70 MB |
| PP-YOLOE+ X 640      | 0.1.1 | 394.16 MB | 197.21 MB | 99.05 MB |
| PP-YOLO Tiny 320     | 0.1.0 |   4.51 MB |         — |        — |

- PicoDet 清单：[`models/pp-detection/1.0.2/manifest.json`](../../models/pp-detection/1.0.2/manifest.json)
- 新 PicoDet 清单：`models/pp-detection/picodet-<size>-<res>/1.0.1/manifest.json`，各规格入口见[模型资产索引](../../models/pp-detection/README.md)
- PP-YOLOE+ S 清单：[`models/ppyoloe-plus-s-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json)
- PP-YOLOE+ M 清单：[`models/ppyoloe-plus-m-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-m-640/0.1.1/manifest.json)
- PP-YOLOE+ L 清单：[`models/ppyoloe-plus-l-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-l-640/0.1.1/manifest.json)
- PP-YOLOE+ X 清单：[`models/ppyoloe-plus-x-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-x-640/0.1.1/manifest.json)

清单逐份固定来源 revision、路径、字节数和 SHA-256。显式来源失败时 SDK 不会静默换源；只有 `source: "auto"` 才会按清单尝试其他来源。

## 精度语义

SDK 参数 `precision: "fp32"` 与 `"fp16"` 分别选择对应浮点变体，`precision: "int8"` 选择 W8A32。W8A32 是权重 INT8 存储、激活与卷积计算 FP32；模型文件缩小不代表运行内存同比下降。FP16 保留敏感算子为 FP32，输入输出仍为 FP32/INT32 契约。

38 个变体均声明 WASM 与 WebGPU 后端。实际加载仍需浏览器能力探测，显式选择不兼容组合会返回 `CAPABILITY_UNSUPPORTED`，不会自动替换精度。`backend: "auto"` 只有配合 `allowFallback: true` 才能在有效候选的会话或推理失败后尝试下一后端。

M/L/X 六个新增 FP16/W8A32 变体（与三个既有 FP32 对照，共九个评测变体）按固定 64 图、桌面 WASM/WebGPU 三轮验证：相对同规格 FP32 的 AP 下降不超过 0.5 个百分点，并在 score≥0.5、同类 IoU≥0.5 下保留至少 95% 的 FP32 检测；IoU≥0.99 只用于坐标偏差诊断。完整证据见[本轮质量报告](../../reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md)。S 与 PicoDet 的三精度证据见[原评测](../../reports/evaluation/2026-09-12-precision-variants/README.md)。这些固定子集结果不是完整 COCO mAP，也不证明普遍加速或峰值内存下降。

小米 15 的实测证据仅覆盖原 FP32，不能据此宣称新增精度或 M/L/X 的移动端兼容性。上游模型来自 PaddleDetection，来源、权重许可和 SHA-256 见各模型卡、[本轮分发证据](../../reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md)与 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。

新增 PicoDet 精度的三轮结果与未发布候选见[本轮对比](../../reports/evaluation/2026-09-15-picodet-series-precision/README.md)。已发布模型版本以清单表为准，FP32 权重沿用原固定来源。

## PP-YOLO Tiny 320 FP32（2026-09-15）

Tiny 首个稳定模型版本为 **0.1.0**，仅提供 FP32，大小 **4.51 MB**；默认 ModelScope，可选 Hugging Face，沿用 SDK/npm **0.4.0**。固定64图桌面三轮结果：子集 AP 为 **22.60**，CPU/GPU 热推理中位数约 **47.46/31.54 ms**。同批次相较 PicoDet-XS-320 FP32，CPU 推理约少28%，文件约大56%，AP低1.21点，适合作为另一种速度与体积取舍。

清单保留 PaddleDetection Apache-2.0 许可和转换归因。上述指标不是全量 COCO 成绩，不扩展 Tiny 的手机或 NPU 兼容声明。见[质量报告](../../reports/evaluation/2026-09-15-2d-candidates/README.md)、[分发验证](../../reports/distribution/2026-09-15-ppyolo-tiny/README.md)与[固定清单](../../models/ppyolo-tiny-320/0.1.0/manifest.json)。
