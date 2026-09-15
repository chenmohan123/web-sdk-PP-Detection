# picodet-xs-416 精度变体 1.0.1

上游为 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，权重及本目录 `LICENSE` 使用 Apache-2.0。本项目维护浏览器 ONNX 转换镜像。

输入：NCHW `1×3×416×416` float32，拉伸、bicubic 插值、1/255 缩放及 ImageNet mean/std 归一化；COCO 80 类轴对齐目标检测。

## 本版本精度与验证

默认 FP32、ModelScope，可显式选择 Hugging Face。FP32 沿用 1.0.0 固定权重，新版本仅追加下表通过门槛的精度。

| 精度 | 字节数 | SHA-256 |
| --- | ---: | --- |
| FP32 | 2903707 | `c0e1208d1c2a30aaabb4cd52f31e07bbf20284ef88e8f12933da5dca481b6239` |
| FP16 | 1875659 | `c416779803cae85b3ebb57ef94068a223578d3c1ac17a30512464433e6af0c97` |

2026-09-15，Windows 11 / Chromium 153 / ORT Web 1.27.0：固定 64 图、716 标注子集，WASM 单线程和物理 NVIDIA WebGPU，各三轮。相对同规格、同后端、同轮 FP32，AP 下降≤0.5个百分点、score≥0.5 且同类 IoU≥0.5 的一对一保留率≥95%；IoU≥0.99仅作坐标诊断。非全量COCO指标，不新增手机或其他浏览器兼容声明。

FP16 保留敏感算子 FP32；W8A32 为权重 INT8、激活与卷积 FP32，SDK precision 参数为 `int8`。文件体积减少是独立收益，不代表普遍加速或内存同比减少。归因与许可沿用上游 Apache-2.0。

转换与逐变体结果：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-picodet-series-precision
