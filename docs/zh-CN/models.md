# 模型与精度

## PP-YOLOE+ S/M/L/X FP32（2026-09-14）

Demo 新增 PP-YOLOE+ M、L、X 640 的 FP32 稳定模型；S 0.1.1 继续保留 FP32、FP16、W8A32。M/L/X 的模型版本均为 0.1.0，只开放 FP32。所有模型均默认 ModelScope，可显式选择 Hugging Face，显式来源失败不静默换源。Demo 总默认仍为 PicoDet、ModelScope、FP32。

| PP-YOLOE+ 规格 | FP32 下载体积 |
| -------------- | ------------: |
| S              |      31.95 MB |
| M              |      94.02 MB |
| L              |     209.18 MB |
| X              |     394.16 MB |

四规格来自同一固定 PaddleDetection 提交的官方 COCO 权重，沿用已发布 S 的 Apache-2.0 发布口径，保留上游许可与转换说明。模型逐份固定双源 revision、路径、字节数和 SHA-256；不是上游官方 Hub 镜像。新增规格的证据限于 Windows 11 / Chromium 153 / ORT Web 1.27.0 桌面，不增加手机兼容承诺。大模型的下载、CPU 推理与内存开销更高；64 图子集指标不是完整 COCO mAP。

本次为模型和 Demo 独立更新，SDK API 与 npm 版本保持 **0.4.0**。见[四规格发布证据](../../reports/distribution/2026-09-14-ppyoloe-smlx/README.md)和[模型清单](../../models/README.md)。

[English](../en/models.md)

## 当前稳定清单（2026-09-12）

当前发布两款模型、每款三种精度，共六个稳定变体。两份清单都默认 ModelScope 和 FP32，并允许显式选择 ModelScope 或 Hugging Face；npm 包不内置清单或 ONNX 权重。

| 模型                | 版本  |     FP32 |     FP16 |   W8A32 |
| ------------------- | ----- | -------: | -------: | ------: |
| PicoDet-L-320 LCNet | 1.0.2 | 23.24 MB | 14.81 MB | 6.12 MB |
| PP-YOLOE+ S 640     | 0.1.1 | 31.95 MB | 16.05 MB | 8.23 MB |

- PicoDet 清单：[`models/pp-detection/1.0.2/manifest.json`](../../models/pp-detection/1.0.2/manifest.json)
- PP-YOLOE 清单：[`models/ppyoloe-plus-s-640/0.1.1/manifest.json`](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json)
- 可运行接入：[六变体示例](../../examples/model-variants/README.md)

公开 Hub 清单使用不可变 revision：ModelScope 为 `88d23d254e9cc2c98874ae8bd8a7c092612e65f6`，Hugging Face 为 `16e7920650777479820b9301dec90a59b0d5833c`。显式来源失败时 SDK 不会静默换源；只有 `source: "auto"` 才会按清单尝试其他来源。

## 精度语义

SDK 参数 `precision: "fp32"` 与 `"fp16"` 分别选择对应浮点变体，`precision: "int8"` 选择 W8A32。W8A32 是权重 INT8 存储、激活与卷积计算 FP32；模型文件缩小不代表运行内存同比下降。FP16 保留敏感算子为 FP32，输入输出仍为 FP32/INT32 契约。

六个变体均声明 WASM 与 WebGPU 后端。实际加载仍需浏览器能力探测，显式选择不兼容组合会返回 `CAPABILITY_UNSUPPORTED`，不会自动替换精度。`backend: "auto"` 只有配合 `allowFallback: true` 才能在有效候选的会话或推理失败后尝试下一后端。

FP16 与 W8A32 已完成 2026-09-12 桌面 WASM/WebGPU 固定 64 图三轮验证。小米 15 的实测证据仅覆盖原 FP32，不能据此宣称 FP16/W8A32 的移动端兼容性。完整识别、速度与逐框差异见[三精度对比](../../reports/evaluation/2026-09-12-precision-variants/README.md)。旧版 FP32、labs/blocked 候选及其带日期报告继续保留为历史证据，不描述当前六变体状态。

上游模型来自 PaddleDetection，来源、权重许可和 SHA-256 见各模型卡与 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。
