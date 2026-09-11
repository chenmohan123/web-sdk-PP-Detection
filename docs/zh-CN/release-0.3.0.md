# 0.3.0 发布说明

[English](../en/release-0.3.0.md)

版本：`web-sdk-pp-detection@0.3.0`。日期：2026-09-12。

## 安装与变更

```bash
pnpm add web-sdk-pp-detection@0.3.0
```

- 增加 PP-YOLOE+ S 640 FP32 `0.1.0 stable` 模型清单，正常加载无需 `allowExperimental`。
- SDK 新增默认关闭的 `allowExperimental?: boolean`。显式开启后允许 labs 变体；blocked 仍拒绝，同精度优先 stable，来源完整性和后端约束保持严格。
- Demo 支持 PicoDet 与 PP-YOLOE，默认 PicoDet；来源只提供 ModelScope 和 Hugging Face，两个模型均默认 ModelScope。切换模型会取消旧任务、释放实例并切换缓存身份。
- 检测列表和导出操作置顶，详细耗时、模型信息和缓存管理按需展开。示例只显示图片，选中信息放入固定工具栏，选中与取消不改变画布位置。
- 修复检测结果显示后快速切换后端可能忽略开始点击的时序问题，按钮在当前任务完整结束后恢复可用。
- 新增固定 COCO 子集、官方 COCOeval、逐框匹配和模型转换/浏览器评测工具，保留原始证据。

模型接入见[示例](../../examples/ppyoloe-candidate/README.md)。其他现有独立示例继续固定到已发布的 0.2.0；它们不使用新增实验选项。

## 模型、来源与许可

| 模型                | 状态与版本     | 默认精度 | 字节数     | SHA-256                                                            |
| ------------------- | -------------- | -------- | ---------- | ------------------------------------------------------------------ |
| PicoDet-L-320 LCNet | `1.0.1 stable` | FP32     | 23,243,834 | `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1` |
| PP-YOLOE+ S 640     | `0.1.0 stable` | FP32     | 31,954,220 | `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c` |

两者均为 opset 11，npm 包不包含 ONNX 权重。[PicoDet 清单](../../models/pp-detection/manifest.json)与[PP-YOLOE 清单](../../models/ppyoloe-plus-s-640/manifest.json)固定来源 URL、revision、大小和 SHA-256。仓库清单默认 Hugging Face，Demo 独立默认 ModelScope；显式来源失败不会静默换源。

PP-YOLOE 的 Hugging Face revision 为 `45a646ce13dcf2e2c05231954b1e32b9c412720b`，ModelScope revision 为 `af865f1c515634de08fe0fc5eeeac8942456241c`。文件路径中的 `0.1.0-labs.1` 是既有不可变资产目录；稳定清单复用同一文件，不修改历史实验清单。当前稳定清单归档在 GitHub `v0.3.0` 标签下。

PP-YOLOE 来自 PaddleDetection 提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 的官方权重，经 Paddle2ONNX 1.3.1 转换及定向图修复。SDK、PaddleDetection 和 Paddle2ONNX 采用 Apache-2.0；ONNX Runtime Web 1.27.0 采用 MIT。模型许可与上游信息见[模型卡](../../models/ppyoloe-plus-s-640/README.md)、[LICENSE](../../models/ppyoloe-plus-s-640/LICENSE)及[第三方声明](../../THIRD_PARTY_NOTICES.md)。

## 后端与验证边界

支持 WASM（CPU）和 WebGPU、main/Worker 模式。Demo 手动后端选择不静默回退；多线程 WASM 仍需 COOP/COEP。

PP-YOLOE 在 2026-09-11 完成 Windows 11、Chromium 153 的 WASM/WebGPU 与固定 64 张 COCO 子集评测，包含 716 条标注。Paddle 参考 AP 为 43.358998%，ONNX/OpenCV 为 43.360019%，ONNX/Pillow 为 43.349885%。这不是全量 COCO mAP；浏览器与上游 JPEG 解码、bicubic 实现存在差异，不能宣称不同预处理逐框一致。详见[评测记录](../../reports/evaluation/2026-09-11-ppyoloe/README.md)。

2026-09-12 小米 15 Android Edge 用户反馈 CPU/GPU 基础功能正常；摄像头截图确认 WebGPU/FP32/main、ORT 1.27.0。用户确认将相同模型字节标记为稳定。完整 Android/HyperOS 版本及 CPU 独立运行时记录尚未补齐；其他设备、Safari、Firefox 和微信 WebView 不因本次发布获得兼容性承诺。详见[实机记录](../../reports/distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md)及[稳定记录](../../reports/stability/2026-09-12-ppyoloe/README.md)。

PicoDet 保留既有七张 fixture 的 Linux WASM 与 Windows NVIDIA WebGPU 证据。FP16、INT8、INT4、FP8 未纳入本次稳定模型范围；微信原生小程序 JavaScript/WASM runtime 不支持。
