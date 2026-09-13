---
license: apache-2.0
pipeline_tag: object-detection
tags:
  - onnx
  - ppyoloe
---

# PP-YOLOE+ L 640 FP32（0.1.0）

本项目自行转换并维护的 PaddleDetection COCO 80 类检测模型镜像。不是 PaddleDetection 官方 ModelScope/Hugging Face 账号。默认 ModelScope，另提供 Hugging Face；两个来源均固定提交、路径、字节数和 SHA-256。

- 上游：[PaddleDetection 固定提交](https://github.com/PaddlePaddle/PaddleDetection/tree/b25522a0f4bde8c80603f3ba5e3472059972e3b5)。
- 配置：`configs/ppyoloe/ppyoloe_plus_crn_l_80e_coco.yml`。
- 官方权重：https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_l_80e_coco.pdparams
- 权重 SHA-256：`4348bb04b0c23b6b815dbc1e05eca22ad62fdf9c42192a600d37497ca4023c88`。
- ONNX：`ppyoloe-plus-l-640-fp32.onnx`，209,181,400 bytes，SHA-256 `01f325d228676b0494e5eec45f10e2830dc9f81bf67a03157c24a0abf7824075`。
- 转换：Paddle 2.6.2、Paddle2ONNX 1.3.1、opset 11；固定 batch=1、640 输入和 scale_factor，并修正两个 Squeeze 轴。复现入口为 SDK 仓库 `tools/model-pipeline/ppyoloe/export.py --variant l` 与 `fix_onnx.py`。
- 许可：沿用已发布 S 的 PaddleDetection Apache-2.0 发布口径，随附上游 LICENSE。固定上游未发现 S/M/L/X 分别适用的不同许可，也未发现独立权重许可文件；不将来源平台本身视为授权方。保留上游归因、许可和转换说明。
- 验证：2026-09-13～14 Windows 11 / Chromium 153 / ORT Web 1.27.0 的桌面证据；64 图 COCO 场景子集不是完整 COCO mAP。新增规格没有移动设备兼容承诺。
- 限制：仅 FP32；大规格占用更多下载空间与运行内存，体积不等于内存峰值。COCO 图片遵守各自许可，本仓库不随权重再分发测试图片。

SDK 和完整发布证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/distribution/2026-09-14-ppyoloe-smlx
