---
license: apache-2.0
pipeline_tag: object-detection
tags:
  - onnx
  - paddledetection
---

# PaddleDetection Web SDK 模型分发

本仓库是 chenmohan 维护的转换权重镜像，提供 ModelScope 与 Hugging Face 固定来源，配合 `web-sdk-pp-detection` 使用。不是 PaddleDetection 官方账号。SDK 默认 ModelScope；ONNX 按需下载，不内置于 npm 包。

当前共 **14 个规格、39 个稳定变体**；Tiny 320 当前清单为 **0.1.1（FP32、FP16）**。

| 模型             | 当前清单                               | 精度              |
| ---------------- | -------------------------------------- | ----------------- |
| PicoDet-XS 320   | picodet-xs-320/1.0.1/manifest.json     | FP32、FP16        |
| PicoDet-XS 416   | picodet-xs-416/1.0.1/manifest.json     | FP32、FP16        |
| PicoDet-S 320    | picodet-s-320/1.0.1/manifest.json      | FP32、FP16、W8A32 |
| PicoDet-S 416    | picodet-s-416/1.0.1/manifest.json      | FP32、FP16、W8A32 |
| PicoDet-M 320    | picodet-m-320/1.0.1/manifest.json      | FP32、FP16、W8A32 |
| PicoDet-M 416    | picodet-m-416/1.0.1/manifest.json      | FP32、FP16、W8A32 |
| PicoDet-L 416    | picodet-l-416/1.0.1/manifest.json      | FP32、FP16、W8A32 |
| PicoDet-L 640    | picodet-l-640/1.0.1/manifest.json      | FP32、FP16、W8A32 |
| PicoDet-L 320    | picodet-l-320/1.0.2/manifest.json      | FP32、FP16、W8A32 |
| PP-YOLOE+ S 640  | ppyoloe-plus-s-640/0.1.1/manifest.json | FP32、FP16、W8A32 |
| PP-YOLOE+ M 640  | ppyoloe-plus-m-640/0.1.1/manifest.json | FP32、FP16、W8A32 |
| PP-YOLOE+ L 640  | ppyoloe-plus-l-640/0.1.1/manifest.json | FP32、FP16、W8A32 |
| PP-YOLO Tiny 320 | ppyolo-tiny-320/0.1.1/manifest.json    | FP32、FP16        |
| PP-YOLOE+ X 640  | ppyoloe-plus-x-640/0.1.1/manifest.json | FP32、FP16、W8A32 |

所有 PP-YOLOE+ 规格来自 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 的官方配置和 COCO 权重，沿用既有 S 的 Apache-2.0 发布口径，保留 LICENSE。各目录模型卡列出原权重、转换修改、摘要和验证限制。COCO 图片各自的许可不被 SDK 或模型仓库许可替代。

SDK、Demo 和测试证据：https://github.com/chenmohan123/web-sdk-PP-Detection

M/L/X 的 0.1.1 新增 FP16 和 W8A32；FP32 复用原 0.1.0 不可变权重。六个新增变体经固定 64 图桌面 WASM/WebGPU 三轮验证，采用 AP 下降≤0.5 个百分点、score≥0.5/同类 IoU≥0.5 保留≥95% FP32 检测的识别门槛。IoU≥0.99 为坐标诊断；FP32 适用于要求原始框位置的场景。体积缩小是独立收益，不代表普遍加速、内存同比减少或新增移动端兼容。SDK/npm 仍为 0.4.0。

本轮质量与分发证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/distribution/2026-09-14-ppyoloe-mlx-precision

## PicoDet 常规系列 FP32（2026-09-15）

现提供 XS/S/M 的 320、416，以及 L 的 320、416、640，共九个 FP32 规格。新增八规格版本 1.0.0，L-320 保持 1.0.2；Demo 默认 L-320 / FP32 / ModelScope，SDK/npm 保持 0.4.0。

同规格官方参考与最终 ONNX 在固定 64 图上对齐，桌面 WASM/WebGPU 均通过质量门槛；36 组 main/Worker 生命周期和双来源下载验证通过。来源为 PaddleDetection release/2.9 官方 LCNet 后处理 ONNX，遵循 Apache-2.0，具体来源、摘要和许可见各规格目录。本轮不增加手机或 NPU 兼容声明。

评测证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-14-picodet-series

## PicoDet 精度扩展（2026-09-15）

新增八个 FP16 和六个 W8A32，该历史批次发布后共 13 个规格、37 个稳定变体。新清单版本为 1.0.1，L-320 保持 1.0.2；默认 L-320、FP32、ModelScope，SDK/npm 保持 0.4.0。三轮固定64图、WASM/WebGPU的六组同规格FP32对比全部达到 AP下降≤0.5点、score≥0.5/同类IoU≥0.5一对一保留率≥95% 才发布。XS-320/416 W8A32保留率不足95%，保留labs，不提供稳定下载。

新增FP16约减少35%–36%文件体积，达标W8A32约减少71%–74%。文件变小不代表普遍加速或峰值内存同比下降。本轮只新增Windows 11 / Chromium153桌面证据。逐变体对比、生命周期和双源验证：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-picodet-series-precision

## PP-YOLO Tiny FP32（2026-09-15）

新增 Tiny 320 FP32 0.1.0，该历史批次发布后共14个规格、38个稳定变体。固定上游、许可、NMS转换和ICC输入边界见对应模型卡；本批仅增加桌面WASM/WebGPU证据。SDK/npm仍为0.4.0。

## PP-YOLO Tiny FP16（2026-09-16）

Tiny 320 新增 0.1.1 稳定清单，复用 0.1.0 FP32 固定来源并新增达标 FP16，当前共14个规格、39个稳定变体。W8A32 未通过 AP 门槛，仅保留 labs，未上传稳定目录。SDK/npm仍为0.4.0；本轮仅新增固定桌面 WASM/WebGPU、main/Worker 与缓存证据，不扩展手机或 NPU 声明。

FP16 为 2,357,376 字节（约 2.36 MB），比 FP32 减少 47.7%；固定 64 图、两后端三轮验证中，最差 AP 下降约 0.175 点、检测保留率至少 99.52%。本机未测得加速，体积缩小不等于运行内存同比下降。

[固定质量与分发证据](https://github.com/chenmohan123/web-sdk-PP-Detection/tree/7516d394be79533fdf4980fab8c02cb198e95d97/reports/distribution/2026-09-16-tiny-precision) · [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/) · [模型对比](https://chenmohan123.github.io/models/pp-detection/compare/)
