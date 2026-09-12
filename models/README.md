# 模型文件

## 当前稳定范围（2026-09-12）

当前 SDK 为 `web-sdk-pp-detection@0.3.1`，提供两款模型、每款三种精度，共六个稳定变体。模型权重从外部固定来源下载，npm 包不内置清单或 ONNX 文件。下表模型大小的单位为字节。

| 模型                | 版本  |       FP32 |       FP16 |     W8A32 | 清单                                               |
| ------------------- | ----- | ---------: | ---------: | --------: | -------------------------------------------------- |
| PicoDet-L-320 LCNet | 1.0.2 | 23,243,834 | 14,813,981 | 6,117,685 | [PicoDet](pp-detection/1.0.2/manifest.json)        |
| PP-YOLOE+ S 640     | 0.1.1 | 31,954,220 | 16,054,567 | 8,225,467 | [PP-YOLOE](ppyoloe-plus-s-640/0.1.1/manifest.json) |

Demo 默认 PicoDet；两份 manifest 均默认 ModelScope 与 FP32，两款模型都可显式选择 ModelScope 或 Hugging Face。显式来源失败时不会静默换源。两份 Hub manifest 使用固定 revision、路径、大小与 SHA-256，Git LFS pointer 不是可运行的模型本体。

W8A32 通过 SDK 参数 `precision: "int8"` 选择，表示权重 INT8 存储、激活与卷积计算 FP32。FP16 保留敏感算子为 FP32。文件缩小不代表运行内存同比下降。

FP16 与 W8A32 已完成 2026-09-12 桌面 WASM/WebGPU 固定 64 图三轮验证。小米 15 用户实测仅覆盖原 FP32；完整环境、指标和限制见[三精度对比](../reports/evaluation/2026-09-12-precision-variants/README.md)。旧版 1.0.1/0.1.0 清单、labs/blocked 候选与带日期报告继续保留为历史证据。

来源、权重许可、固定上游提交和模型 SHA-256 分别见 [PicoDet 模型卡](pp-detection/1.0.2/README.md)、[PP-YOLOE 模型卡](ppyoloe-plus-s-640/0.1.1/README.md)及[第三方声明](../THIRD_PARTY_NOTICES.md)。生成新清单时必须绑定实际文件的 bytes、SHA-256、opset、输入输出、后处理和不可变来源，并以新模型版本发布。

## English entry

当前发布 PicoDet-L-320 1.0.2 与 PP-YOLOE+ S 640 0.1.1 的 FP32、FP16、W8A32 六个稳定变体。默认组合为 PicoDet、ModelScope、FP32；W8A32 对应 SDK 的 `precision: "int8"`。FP16/W8A32 当前证据仅覆盖 2026-09-12 桌面 64 图验证，小米 15 实测仅覆盖原 FP32。
