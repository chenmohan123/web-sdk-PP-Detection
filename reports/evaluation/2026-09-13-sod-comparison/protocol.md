# PP-YOLOE+ SOD L 与普通 L 对照协议

## 评测前约定

本轮属于 PP-Detection 单 SDK 的候选评估，沿用多模型路线任务 4。以普通 PP-YOLOE+ L 80e COCO 为基线，与已验证的 SOD L 80e COCO 比较；二者固定 PaddleDetection `b25522a0f4bde8c80603f3ba5e3472059972e3b5`、FP32、单张 640 × 640 输入。不重新训练，也不启用切片或小目标增强。

复用 2026-09-11 已锁定的 64 图 COCO 子集、原始类别 ID、图片顺序和标注，不根据本轮模型输出筛图。它是有小目标场景的工程样本，不能代替完整 COCO val2017 的总体结论。

## 一致设置与验证

- 官方配置均使用 NMS `score_threshold=0.01`、`nms_threshold=0.7`、`nms_top_k=1000`、`keep_top_k=300`。导出保留这些设置，图中阈值构成实际候选框下限。
- Python 质量对比使用 RGB、OpenCV INTER_CUBIC、除以 255、NCHW、无额外均值标准化；官方 pycocotools 计算 AP、AP50、AP75 和 APSmall，`maxDets=[1,10,100]`。COCO small 使用标注面积范围，而非人工看图分类。
- 普通 L 先通过官方 Paddle 与 ONNX 的 64 图逐框核验：显示阈值 0.5、IoU 至少 0.99、零未匹配框；同时报告低分框 AP 差异。
- 浏览器使用同一 SDK 构建、ORT 版本和物理适配器。两模型顺序运行 WebGPU 64 图及 WASM 前 8 图，使用同一主线程模式、WASM 单线程、Pillow 对齐的 bicubic 预处理和相同阈值。Worker 生命周期沿用上一阶段 SOD 四组合证据。
- 浏览器输出与相应模型的 Pillow Python 参考逐框对齐；不得把 OpenCV 与 Pillow 的预处理差异归因于模型。
- 沿用第二模型评测发现的 JPEG 解码差异处理方式：浏览器输入由 OpenCV 读取原 JPEG 后保存的无损 PNG；逐张核实像素相等并记录源 JPEG 和 PNG 摘要，使 Python 与浏览器使用相同像素。浏览器解码耗时对应 PNG，不代表 JPEG 解码速度。
- 记录模型字节数、SHA-256、会话耗时、首张耗时、排除首张后的中位数与 P90。Python CPU 和浏览器 WASM 是不同执行环境，分别报告。

## 决策规则

报告全部结果，即使 SOD 的小目标 AP 或速度低于普通 L。若没有可见的小目标收益，保持 `selected` 研究状态，并优先已证明价值的模型；若收益明显，则结合体积、桌面耗时和许可证据制定独立接入计划。64 图上的提升只支持该样本范围，不保证每张图片都更好。

分发审查单独记录官方来源、许可与署名义务、模型卡、ModelScope/Hugging Face 固定 revision 及下载完整性状态。未上传的目标只能写为待准备，不能伪造正式来源。手机复核按发布范围和风险安排，不阻塞本轮电脑端评估。
