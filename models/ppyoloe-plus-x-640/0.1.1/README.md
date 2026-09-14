---
license: apache-2.0
pipeline_tag: object-detection
tags:
  - onnx
  - ppyoloe
---

# PP-YOLOE+ X 640 FP32 / FP16 / W8A32（0.1.1）

本项目自行转换并维护的 PaddleDetection COCO 80 类检测模型镜像。不是 PaddleDetection 官方 ModelScope/Hugging Face 账号。默认 ModelScope，另提供 Hugging Face；两个来源均固定提交、路径、字节数和 SHA-256。

- 上游：[PaddleDetection 固定提交](https://github.com/PaddlePaddle/PaddleDetection/tree/b25522a0f4bde8c80603f3ba5e3472059972e3b5)。
- 配置：`configs/ppyoloe/ppyoloe_plus_crn_x_80e_coco.yml`。
- 官方权重：https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_x_80e_coco.pdparams
- 权重 SHA-256：`83282fb62131a72e4538ec16c45739bec444da2ac849bccff5dfd69da3dd9fca`。
- ONNX：`ppyoloe-plus-x-640-fp32.onnx`，394,163,636 bytes，SHA-256 `90b8ea67186b6df262b5ea441e4392144b71fa2562593892d60e2e81d5a0811e`。
- 转换：Paddle 2.6.2、Paddle2ONNX 1.3.1、opset 11；固定 batch=1、640 输入和 scale_factor，并修正两个 Squeeze 轴。复现入口为 SDK 仓库 `tools/model-pipeline/ppyoloe/export.py --variant x` 与 `fix_onnx.py`。
- 许可：沿用已发布 S 的 PaddleDetection Apache-2.0 发布口径，随附上游 LICENSE。固定上游未发现 S/M/L/X 分别适用的不同许可，也未发现独立权重许可文件；不将来源平台本身视为授权方。保留上游归因、许可和转换说明。
- 验证：2026-09-13～14 Windows 11 / Chromium 153 / ORT Web 1.27.0 的桌面证据；64 图 COCO 场景子集不是完整 COCO mAP。新增规格没有移动设备兼容承诺。
- 限制：新增精度仅有本轮桌面证据；大规格占用更多下载空间与运行内存，体积不等于内存峰值。COCO 图片遵守各自许可，本仓库不随权重再分发测试图片。

SDK 和完整发布证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/distribution/2026-09-14-ppyoloe-mlx-precision

## 精度变体与发布门槛

FP32 复用已发布 0.1.0 固定来源；新压缩权重位于本版本目录。当前清单默认 FP32、ModelScope，可显式选择 Hugging Face。

| 精度 | 文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| FP32 | `ppyoloe-plus-x-640-fp32.onnx` | 394163636 | `90b8ea67186b6df262b5ea441e4392144b71fa2562593892d60e2e81d5a0811e` |
| FP16 | `ppyoloe-plus-x-640-fp16.onnx` | 197207187 | `0432be99a5012c427c685280df97e7b876345830b608396f0f87617f259c1394` |
| W8A32 | `ppyoloe-plus-x-640-w8a32.onnx` | 99048805 | `fbc57fbfe6e4e4497a08a3cecbf9c62f93d2c5963b4ddf2af1cb7dfc8cd9ee56` |

FP16 使用工具 `float16_models.py`，保留敏感算子 FP32；W8A32 使用 `weight_only.py`，权重 INT8、激活及卷积计算 FP32，SDK precision 为 `int8`。固定转换参数和原始转换记录见 SDK 的 `reports/evaluation/2026-09-14-ppyoloe-mlx-precision/`。

六个新增变体按同规格、同后端 FP32 对照：固定 64 图桌面 WASM/WebGPU 三轮，AP 下降不超过 0.5 个百分点，score≥0.5、同类 IoU≥0.5 一对一匹配保留至少 95% FP32 检测。IoU≥0.99 仅诊断坐标偏差；需要贴近 FP32 框坐标时选择 FP32。另验证 main/Worker 预取消、恢复和释放。体积缩小是独立收益，不承诺普遍加速或运行内存同比缩小。
