# 模型与精度

[English](../en/models.md)

## 当前稳定清单（2026-09-14）

当前发布 PicoDet-L 320 与 PP-YOLOE+ S/M/L/X 640 五款模型，每款三种精度，共 15 个稳定变体。五份清单都默认 ModelScope 和 FP32，并允许显式选择 ModelScope 或 Hugging Face；npm 包不内置清单或 ONNX 权重。

| 模型                | 版本  |     FP32 |     FP16 |   W8A32 |
| ------------------- | ----- | -------: | -------: | ------: |
| PicoDet-L-320 LCNet | 1.0.2 | 23.24 MB | 14.81 MB | 6.12 MB |
| PP-YOLOE+ S 640     | 0.1.1 | 31.95 MB | 16.05 MB | 8.23 MB |
| PP-YOLOE+ M 640     | 0.1.1 | 94.02 MB | 47.10 MB | 23.82 MB |
| PP-YOLOE+ L 640     | 0.1.1 | 209.18 MB | 104.70 MB | 52.70 MB |
| PP-YOLOE+ X 640     | 0.1.1 | 394.16 MB | 197.21 MB | 99.05 MB |

- PicoDet 清单：[`models/pp-detection/1.0.2/manifest.json`](../../models/pp-detection/1.0.2/manifest.json)
- PP-YOLOE+ S 清单：[`models/ppyoloe-plus-s-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json)
- PP-YOLOE+ M 清单：[`models/ppyoloe-plus-m-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-m-640/0.1.1/manifest.json)
- PP-YOLOE+ L 清单：[`models/ppyoloe-plus-l-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-l-640/0.1.1/manifest.json)
- PP-YOLOE+ X 清单：[`models/ppyoloe-plus-x-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-x-640/0.1.1/manifest.json)

清单逐份固定来源 revision、路径、字节数和 SHA-256。显式来源失败时 SDK 不会静默换源；只有 `source: "auto"` 才会按清单尝试其他来源。

## 精度语义

SDK 参数 `precision: "fp32"` 与 `"fp16"` 分别选择对应浮点变体，`precision: "int8"` 选择 W8A32。W8A32 是权重 INT8 存储、激活与卷积计算 FP32；模型文件缩小不代表运行内存同比下降。FP16 保留敏感算子为 FP32，输入输出仍为 FP32/INT32 契约。

15 个变体均声明 WASM 与 WebGPU 后端。实际加载仍需浏览器能力探测，显式选择不兼容组合会返回 `CAPABILITY_UNSUPPORTED`，不会自动替换精度。`backend: "auto"` 只有配合 `allowFallback: true` 才能在有效候选的会话或推理失败后尝试下一后端。

M/L/X 九个新增精度变体按固定 64 图、桌面 WASM/WebGPU 三轮验证：相对同规格 FP32 的 AP 下降不超过 0.5 个百分点，并在 score≥0.5、同类 IoU≥0.5 下保留至少 95% 的 FP32 检测；IoU≥0.99 只用于坐标偏差诊断。完整证据见[本轮质量报告](../../reports/evaluation/2026-09-14-ppyoloe-mlx-release/README.md)。S 与 PicoDet 的三精度证据见[原评测](../../reports/evaluation/2026-09-12-precision-variants/README.md)。这些固定子集结果不是完整 COCO mAP，也不证明普遍加速或峰值内存下降。

小米 15 的实测证据仅覆盖原 FP32，不能据此宣称新增精度或 M/L/X 的移动端兼容性。上游模型来自 PaddleDetection，来源、权重许可和 SHA-256 见各模型卡、[本轮分发证据](../../reports/distribution/2026-09-14-ppyoloe-mlx-precision/README.md)与 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。
