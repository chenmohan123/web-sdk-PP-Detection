---
license: apache-2.0
pipeline_tag: object-detection
tags:
  - onnx
  - paddledetection
---

# PaddleDetection Web SDK 模型分发

本仓库是 chenmohan 维护的转换权重镜像，提供 ModelScope 与 Hugging Face 固定来源，配合 `web-sdk-pp-detection` 使用。不是 PaddleDetection 官方账号。SDK 默认 ModelScope；ONNX 按需下载，不内置于 npm 包。

| 模型 | 当前清单 | 精度 |
| --- | --- | --- |
| PicoDet-L 320 | picodet-l-320/1.0.2/manifest.json | FP32、FP16、W8A32 |
| PP-YOLOE+ S 640 | ppyoloe-plus-s-640/0.1.1/manifest.json | FP32、FP16、W8A32 |
| PP-YOLOE+ M 640 | ppyoloe-plus-m-640/0.1.1/manifest.json | FP32、FP16、W8A32 |
| PP-YOLOE+ L 640 | ppyoloe-plus-l-640/0.1.1/manifest.json | FP32、FP16、W8A32 |
| PP-YOLOE+ X 640 | ppyoloe-plus-x-640/0.1.1/manifest.json | FP32、FP16、W8A32 |

所有 PP-YOLOE+ 规格来自 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 的官方配置和 COCO 权重，沿用既有 S 的 Apache-2.0 发布口径，保留 LICENSE。各目录模型卡列出原权重、转换修改、摘要和验证限制。COCO 图片各自的许可不被 SDK 或模型仓库许可替代。

SDK、Demo 和测试证据：https://github.com/chenmohan123/web-sdk-PP-Detection

M/L/X 的 0.1.1 新增 FP16 和 W8A32；FP32 复用原 0.1.0 不可变权重。六个新增变体经固定 64 图桌面 WASM/WebGPU 三轮验证，采用 AP 下降≤0.5 个百分点、score≥0.5/同类 IoU≥0.5 保留≥95% FP32 检测的识别门槛。IoU≥0.99 为坐标诊断；FP32 适用于要求原始框位置的场景。体积缩小是独立收益，不代表普遍加速、内存同比减少或新增移动端兼容。SDK/npm 仍为 0.4.0。

本轮质量与分发证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/distribution/2026-09-14-ppyoloe-mlx-precision
