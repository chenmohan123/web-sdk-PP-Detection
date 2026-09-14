# PicoDet-M-320 LCNet 模型卡

本目录提供版本 1.0.0 的 FP32 ONNX 模型。上游为 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，权重及本目录 `LICENSE` 使用 Apache-2.0。

- 输入与预处理：NCHW `1x3x320x320` float32，拉伸到 320 x 320，bicubic 插值，缩放系数 1/255，ImageNet mean/std 归一化。
- 文件：`picodet-m-320-fp32.onnx`，13905160 字节，SHA-256 `2914a3bc0475e6596baac9495eea798da99aadc8db48afd995c53906f8299474`。
- ModelScope revision：`39739aafe769e1fc2843bc9f7bd3b6c3512e217a`。
- Hugging Face revision：`aeebbf3b839ee187a20f8e2388e85ee0bc6aa8d3`。
- 验证范围：2026-09-15，Windows 11、Chromium 153，固定 64 图，桌面 WASM、物理 NVIDIA WebGPU 及官方/候选 ORT 对齐通过。

该验证不是完整 COCO mAP，不证明手机、WebNN、S-NPU 或其他设备的兼容性，也不构成普适性能承诺。完整字段及下载路径见同目录 `manifest.json`。
