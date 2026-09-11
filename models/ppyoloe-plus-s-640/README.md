# PP-YOLOE+ S 640 FP32（稳定）

此目录描述 `ppyoloe-plus-s-640` 的 `0.1.0 stable` 清单。模型用于浏览器端目标检测，输入为 `1x3x640x640` FP32 张量，输出包含图内 NMS 后的 `[N,6]` 检测结果和 `[1]` 检测数量。2026-09-12 根据用户确认转为稳定状态，默认加载无需 `allowExperimental`。Demo 默认模型仍为 PicoDet。

稳定清单复用已分发的相同 ONNX 字节和不可变来源；URL 中的 `0.1.0-labs.1` 是历史资产目录，不决定当前清单状态。Hub 上已有固定清单与旧模型卡属于实验版快照。状态变更和旧文件字节见[稳定记录](../../reports/stability/2026-09-12-ppyoloe/README.md)。

## 来源与许可

- 上游项目：[PaddlePaddle/PaddleDetection](https://github.com/PaddlePaddle/PaddleDetection/tree/b25522a0f4bde8c80603f3ba5e3472059972e3b5)
- 固定上游 revision：`b25522a0f4bde8c80603f3ba5e3472059972e3b5`
- 配置：`configs/ppyoloe/ppyoloe_plus_crn_s_80e_coco.yml`
- 权重：`ppyoloe_plus_crn_s_80e_coco.pdparams`
- 许可：Apache License 2.0，完整文本见同目录 `LICENSE`

模型由 PaddleDetection 官方权重导出为 Paddle 静态模型，再用 Paddle2ONNX 1.3.1 转换为 opset 11。原转换图无法由 ONNX Runtime 建立 Session；定向修复只固定 image batch=1、将 `scale_factor` 固定为 `[[1,1]]`，并将 NMS 类别和框索引列的两个 Squeeze 固定为 `axes=[1]`。转换、修复及输入文件哈希见 `reports/evaluation/2026-09-11-ppyoloe/conversion.lock.json` 和 `sources.lock.json`。

## 预处理与输出

- 图片以 stretch 模式缩放为 640x640，RGB，除以 255，mean=0、std=1。
- SDK 清单声明 `bicubic`，浏览器实现与评测中的 Pillow bicubic 对齐。
- 上游官方 reader 使用 OpenCV `INTER_CUBIC`。两种预处理在 64 张子集上的 AP 接近，但严格匹配时只匹配 389/443 项检测，不能宣称逐框一致。
- 模型已执行图内 NMS。SDK 后处理阈值使用 score `0.001`、IoU `1.0`，避免再次收紧检测集合。

## 已有证据

2026-09-11 在固定的 64 张 COCO val2017 场景覆盖子集上完成评测。该子集包含 716 条标注，不等于全量 COCO mAP，也不构成统计显著性证明。

- Paddle 官方静态模型 AP：`43.358998%`
- ONNX/OpenCV AP：`43.360019%`
- ONNX/Pillow AP：`43.349885%`
- Paddle 与 ONNX/OpenCV 在 score>=0.5、同类 IoU>=0.99 下匹配 443/443 项检测
- Chromium 153、Windows 11 上的 WASM 和 WebGPU 路径均完成相同 64 张图片验证

完整指标、运行环境、逐图预测哈希和对齐报告位于 `reports/evaluation/2026-09-11-ppyoloe/`。

2026-09-12 小米 15 用户反馈 CPU/GPU 正常；Android Edge 摄像头截图确认实际 WebGPU/FP32/main、ORT 1.27.0。实测范围与原图见[移动端记录](../../reports/distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md)。用户据此明确确认稳定状态，其他设备按后续实际反馈维护。

## 限制

- 该版本为 FP32 稳定模型，支持已验证的 `wasm` 和 `webgpu`；FP16、INT8、INT4、FP8 未纳入本版本。
- 移动端已有小米 15 Android Edge 基础功能实测，其他移动设备、微信 WebView、其他浏览器和 GPU 仍需各自的运行证据。
- 浏览器 JPEG 解码路径与 Pillow CPU 参考存在差异；同一 RGBA 输入下 WebGPU 与 Pillow 参考匹配 443/443 项检测。
- 分发文件必须通过固定 revision URL 下载，并校验 `31,954,220` 字节和 SHA-256 `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c`。
