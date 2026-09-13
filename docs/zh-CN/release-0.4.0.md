# 0.4.0 发布说明

[English](../en/release-0.4.0.md)

版本：`web-sdk-pp-detection@0.4.0`。日期：2026-09-13。

## 安装与变更

```bash
pnpm add web-sdk-pp-detection@0.4.0
```

图片中目标较小时，可显式启用 `detect(image, { smallObjectEnhancement: true })`。默认关闭，普通检测沿用整图流程。Demo 图片模式提供“小目标增强（实验）”开关，视频和摄像头保持普通检测。

- 一次解码，同一会话串行执行整图和最多四片，结果统一投影回原图并合并；全局与类别阈值在合并后应用。
- `onProgress` 返回 `completed/total`，总推理次数为 1–5；结果中的 `smallObjectEnhancement.passes` 记录实际次数。普通模式无该结果字段。
- 支持 WASM/WebGPU、main/Worker，以及取消和释放。取消丢弃本次结果；Worker 模式仍由调用线程负责解码、裁切和合并。
- 增强输入最多 16,777,216 像素，超出时拒绝，不自动缩图。浏览器自身的 Blob 解码可能先于像素检查。
- 预处理计时包含裁切，后处理计时包含投影和合并，推理计时累加各次调用；端到端包含让出主线程的等待，不含下载、初始化和排队。

新增参数均可选，原有调用无需修改。API 契约见 [API 文档](api.md)。

## 模型、来源与许可

沿用 [PicoDet 1.0.2](../../models/pp-detection/1.0.2/manifest.json) 与 [PP-YOLOE 0.1.1](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json) 的六个稳定变体。Demo 默认 PicoDet、FP32、ModelScope，两个模型均默认 ModelScope，可显式选择 Hugging Face。来源使用清单固定的 revision、字节数和 SHA-256，显式来源失败不静默换源。npm 包不包含模型权重或默认清单。

| 模型            | FP32 字节数 | FP16 字节数 | W8A32 字节数 |
| --------------- | ----------: | ----------: | -----------: |
| PicoDet-L-320   |    23243834 |    14813981 |      6117685 |
| PP-YOLOE+ S 640 |    31954220 |    16054567 |      8225467 |

模型来自 PaddleDetection 官方权重，使用 Paddle2ONNX 转换。SDK、PaddleDetection、Paddle2ONNX 采用 Apache-2.0；ONNX Runtime Web 1.27.0 采用 MIT。详见[第三方声明](../../THIRD_PARTY_NOTICES.md)。

## 验证与限制

小目标增强仍为实验功能。独立高分辨率评测的严格误检门槛未通过，可能增加误检和耗时，不能保证每张图片都改善；见[第二轮对比](../../reports/evaluation/2026-09-12-tiling-refinement/README.md)。模型稳定状态与该实验功能的成熟度分别记录。

2026-09-13 在 Windows、Chromium 153.0.8010.12、ORT 1.27.0、物理 NVIDIA Blackwell 环境，完成两模型 × 三精度 × 两后端 × main/Worker 共 24 组真实模型迁移验证，结果与冻结实验流程逐框一致。这是迁移正确性验证，不是新增全量 COCO mAP 或性能基准。详情见[接入验证](../../reports/verification/2026-09-13-small-objects/README.md)。

同日用户用小米 15 在局域网 HTTPS 测试后反馈“基本上是对的”；未逐项列明模型、精度、实际后端、浏览器版本和全部媒体/取消行为，因此不据此补齐手机兼容矩阵。微信原生小程序不支持该 JavaScript/WASM runtime；多线程 WASM 依赖 COOP/COEP。

发布检查、远程保护与线上验收见[本版验收](../../reports/releases/2026-09-13-0.4.0/README.md)。
