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
