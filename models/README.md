# 模型文件

当前 SDK 为 `web-sdk-pp-detection@0.3.1`，提供两款 FP32 稳定模型。模型权重由外部固定来源下载，npm 包不携带 ONNX 文件。

| 模型                | 模型版本 | 状态   | 文件字节数 | 清单                                         |
| ------------------- | -------- | ------ | ---------: | -------------------------------------------- |
| PicoDet-L-320 LCNet | 1.0.1    | stable | 23,243,834 | [PicoDet](pp-detection/manifest.json)        |
| PP-YOLOE+ S 640     | 0.1.0    | stable | 31,954,220 | [PP-YOLOE](ppyoloe-plus-s-640/manifest.json) |

Demo 默认 PicoDet，两款模型的来源选项均为 ModelScope（默认）和 Hugging Face。SDK 清单自身默认 Hugging Face；SDK 还允许清单明确提供的 Git LFS 或自托管来源。显式指定来源失败时不会静默换源。

两份清单固定来源 revision、大小和 SHA-256。稳定 PP-YOLOE 复用 `0.1.0-labs.1` 目录中的同一文件，历史目录名不决定当前状态；稳定清单归档于 [v0.3.0](https://github.com/chenmohan123/web-sdk-PP-Detection/tree/v0.3.0/models)。Git LFS pointer 不是可运行的模型本体。

## 来源、许可与验证

两款模型来自 PaddleDetection，PP-YOLOE 经 Paddle2ONNX 转换与定向修复。来源、权重许可、固定上游提交和模型 SHA-256 分别见 [PicoDet 模型卡](pp-detection/README.md)、[PP-YOLOE 模型卡](ppyoloe-plus-s-640/README.md)及[第三方声明](../THIRD_PARTY_NOTICES.md)。不能使用其他模型或 PaddleOCR 的历史记录作为这两款模型的证据。

2026-09-12 正式 Demo 的两模型 WASM / NVIDIA WebGPU 路径已通过。小米 15 用户反馈 CPU/GPU 基础功能正常，完整系统版本与 CPU 独立记录待补齐。64 张 COCO 子集评测不代表完整 COCO mAP。验证结果、运行环境和边界见 [0.3.0 发布说明](../docs/zh-CN/release-0.3.0.md)及 [Release 验收附件](https://github.com/chenmohan123/web-sdk-PP-Detection/releases/tag/v0.3.0)。

## 新变体

当前稳定范围仅为 FP32。FP16、INT8、INT4、FP8 需分别完成转换、数值、后端和设备验证。FP16 专项候选保留为独立实验产物，状态为 labs/blocked；转换成功不等于可提升为 stable。

生成新清单时绑定实际文件的 bytes、SHA-256、opset、输入输出、后处理和不可变来源。以新模型版本发布，保留旧清单及原始评测；不要覆盖已发布标签、模型目录或历史资产。

## English entry

The current release provides PicoDet-L-320 1.0.1 and PP-YOLOE+ S 640 0.1.0 as FP32 stable models. The Demo defaults to PicoDet and ModelScope for both models; Hugging Face remains selectable. See the [release notes](../docs/en/release-0.3.0.md) for immutable sources, licenses, dated validation, and limitations. New precision variants require separate validation and versioned publication.
