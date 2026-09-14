# 第三方声明

本 SDK 代码采用 Apache-2.0。模型文件、权重、标签和数据集不因 SDK 许可证自动获得相同许可；每个发布变体必须在模型 manifest 中记录上游 revision、字节数、SHA-256 和许可证。

## 运行时依赖

- ONNX Runtime Web 1.27.0：MIT，见 https://github.com/microsoft/onnxruntime
- TypeScript、tsup、Vite、React 等开发工具：按各自上游许可证使用。

## 模型与转换工具

- PaddleDetection：Apache-2.0，见 https://github.com/PaddlePaddle/PaddleDetection；具体权重和 COCO 标签许可需逐变体验证。
- Paddle2ONNX：Apache-2.0，见 https://github.com/PaddlePaddle/Paddle2ONNX；仅用于离线转换。
- Git LFS、Hugging Face、ModelScope 是分发来源，不改变上游模型许可。

在模型许可、数据集限制或再分发授权未核实前，资产只能作为外部来源引用，不会写入默认发布包或 npm tarball。

## PP-YOLOE+ M/L/X 三精度（2026-09-14）

新增三规格与已发布 S 均使用 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 中的 `ppyoloe_plus_crn_{s,m,l,x}_80e_coco.yml` 及官方 `paddledet.bj.bcebos.com/models/` 权重。沿用 S 的 Apache-2.0 发布口径；未发现按规格不同的许可或独立权重许可文件，不将 Hub 镜像平台视为授权方。各版本目录保留 LICENSE、原始权重 SHA-256 和转换修改说明。所有镜像由本项目转换维护，并非 PaddleDetection 官方 Hub 发布。

[M 模型卡](models/ppyoloe-plus-m-640/0.1.1/README.md)、[L 模型卡](models/ppyoloe-plus-l-640/0.1.1/README.md)、[X 模型卡](models/ppyoloe-plus-x-640/0.1.1/README.md)。COCO 标签及图片遵守既有归因和逐图许可，不随 SDK 许可重新授权。

FP16 与 W8A32 从同规格已验证的 FP32 转换，沿用相同上游归因和许可证。FP16 保留敏感算子 FP32，W8A32 为权重 INT8、激活和卷积计算 FP32；每个新版本模型卡记录转换工具、产物摘要与验证边界。旧 0.1.0 模型卡和原始权重来源继续保留。
