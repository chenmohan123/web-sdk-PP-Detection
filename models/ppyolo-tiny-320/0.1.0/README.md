# PP-YOLO Tiny 320 FP32（0.1.0）

本镜像由 chenmohan 转换维护，并非 PaddleDetection 官方账号。上游代码和权重按 Apache-2.0 分发，完整原文见 LICENSE。

固定上游提交：`b25522a0f4bde8c80603f3ba5e3472059972e3b5`。
配置：https://github.com/PaddlePaddle/PaddleDetection/blob/b25522a0f4bde8c80603f3ba5e3472059972e3b5/configs/ppyolo/ppyolo_tiny_650e_coco.yml
权重：https://paddledet.bj.bcebos.com/models/ppyolo_tiny_650e_coco.pdparams
原权重 SHA-256：`fc3d31cb1642e313bf1efd1e4c0015f2f836c37ed1d15b200f6500768beda3f0`。

最终 ONNX：4,511,117 字节；SHA-256 `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653`；实际 opset 14。
Paddle可训练参数为 1,086,147；358个Parameter共1,102,131元素，排除stop_gradient状态后统计。不用ONNX initializer估算参数。

Paddle2ONNX 1.3.1 导出，原始ONNX SHA-256 `2091c6054dc798caffd26ec69658205f577539d33da8b6e1e9c7f17ffe68f0b4`。
修正NMS的 Squeeze.7/Squeeze.9 为 axes=[0,2]，保留单检测框轴；固定batch=1、im_shape=[[320,320]]、scale_factor=[[1,1]]，不更改权重。完整转换记录见 conversion.json。

输入为float32 NCHW 1×3×320×320 RGB，拉伸、bicubic缩放、1/255缩放，再按ImageNet mean=[0.485,0.456,0.406]、std=[0.229,0.224,0.225]归一化，COCO 80类；输出为模型内NMS处理后的检测与计数，SDK执行坐标映射。完整输入、预处理和后处理以同版本manifest为准。

2026-09-15 在 Windows 11 / Chromium 153.0.8010.12、ORT Web 1.27.0、SDK 0.4.0 上验证：固定64张图、716个标注，两后端各三轮及main/Worker四组合生命周期。采用浏览器实际float32输入与Python参考逐框比较，不拿其他模型的AP当作自身FP32通过门槛。
浏览器对ICC图片进行色彩管理，未经ICC处理的Pillow输入可能不同；跨预处理路径结果不能直接归因为后端错误。仅有本批桌面WASM和物理NVIDIA WebGPU证据，不声明手机、NPU或其他浏览器兼容，也不代表全量COCO指标或普遍性能优势。

质量证据：https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-2d-candidates
