---
license: apache-2.0
pipeline_tag: object-detection
tags:
- onnx
- webgpu
- wasm
- fp16
- int8
---
# PicoDet-L 320 多精度模型 1.0.2

提供 FP32、FP16 与 W8A32 选择，适用于 web-sdk-pp-detection@0.3.1 及兼容版本。新增 FP16 与 W8A32 权重在本目录；FP32 继续引用已发布的不可变源文件。

FP16 保留敏感算子为 FP32，浮点输入输出保持 FP32，检测数量保持 INT32。W8A32 仅将卷积权重存为 INT8，经反量化进行 FP32 卷积，激活保持 FP32；SDK precision 参数为 int8，模型清单 quantization 明确标记 weight-only-int8-activation-fp32。

使用 ModelScope 或 Hugging Face 的固定 revision 清单加载模型，默认来源为 ModelScope，默认精度 FP32。每个文件以 bytes 和 SHA-256 校验；两Hub文件相同。

2026-09-12 在 Windows 11、Chromium 153、ONNX Runtime Web 1.27.0、物理 NVIDIA GPU 与 WASM 单线程上使用固定 COCO val2017 64 图（716标注）进行质量及三轮性能对照。该子集不等于全量 COCO 成绩，文件减少不等于峰值内存同比减少。FP16/W8A32 未覆盖手机实测；设备兼容性按实际证据维护。

上游 PaddleDetection 采用 Apache-2.0，具体固定源和转换哈希见 conversion 文件及仓库评测报告：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-12-precision-variants 。

Demo：https://chenmohan123.github.io/web-sdk-PP-Detection/ 。体积收益与推理速度分别记录，不以单轮耗时波动宣称普遍加速。
