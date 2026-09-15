# picodet-s-320 精度变体 1.0.1

上游为 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，权重及本目录 `LICENSE` 使用 Apache-2.0。本项目维护浏览器 ONNX 转换镜像。

输入：NCHW `1×3×320×320` float32，拉伸、bicubic 插值、1/255 缩放及 ImageNet mean/std 归一化；COCO 80 类轴对齐目标检测。

## 本版本精度与验证

默认 FP32、ModelScope，可显式选择 Hugging Face。FP32 沿用 1.0.0 固定权重，新版本仅追加下表通过门槛的精度。

| 精度 | 字节数 | SHA-256 |
| --- | ---: | --- |
| FP32 | 4807906 | `84cd653b3615f63f6e8d478d8c590578a6c9b0608d597948799e599e5c3ad1ab` |
| FP16 | 3082899 | `b54a67ac5acb73023c74162732d1ff6bbe0d367963d562659a363fa602c26c46` |
| W8A32 | 1380421 | `1fba3b2bef155c51bc971d1b9628923ec3668b40542b1677cb8b0cf15889c154` |

2026-09-15，Windows 11 / Chromium 153 / ORT Web 1.27.0：固定 64 图、716 标注子集，WASM 单线程和物理 NVIDIA WebGPU，各三轮。相对同规格、同后端、同轮 FP32，AP 下降≤0.5个百分点、score≥0.5 且同类 IoU≥0.5 的一对一保留率≥95%；IoU≥0.99仅作坐标诊断。非全量COCO指标，不新增手机或其他浏览器兼容声明。

FP16 保留敏感算子 FP32；W8A32 为权重 INT8、激活与卷积 FP32，SDK precision 参数为 `int8`。文件体积减少是独立收益，不代表普遍加速或内存同比减少。归因与许可沿用上游 Apache-2.0。

转换与逐变体结果：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-picodet-series-precision
