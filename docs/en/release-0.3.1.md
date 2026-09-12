# 0.3.1 发布说明

[简体中文](../zh-CN/release-0.3.1.md)

版本：`web-sdk-pp-detection@0.3.1`。日期：2026-09-12。

## 安装与变更

```bash
pnpm add web-sdk-pp-detection@0.3.1
```

- 合并 bicubic 三通道重复运算，共享重采样系数和索引；保留每通道的累加、两次 8 位裁剪及舍入顺序，使用 Float32 归一化查表并直接写入 CHW。
- 128 组新旧预处理张量逐位一致；固定 64 张 COCO 子集、12 轮检测中，同后端的新旧预测逐项完全相等。
- 本机 PP-YOLOE WebGPU 三轮热端到端中位数由 113.59 降至 84.62 ms（减少 25.5%），预处理中位数由 52.89 降至 24.09 ms（减少 54.4%）。这是桌面观测，不代表所有设备；CPU 端到端收益较小，完整数据见[性能报告](../../reports/evaluation/2026-09-12-preprocess/README.md)。
- 小米 15 Android Edge 用户确认两款模型 CPU/GPU 基础回归正常。截图直接确认 PP-YOLOE WebGPU/FP32/main，见[实机记录](../../reports/releases/2026-09-12-0.3.1/mobile-xiaomi15.md)。
- npm 发布后等待 registry 最多十分钟，区分暂时与永久错误，并保存成功或失败记录。
- 归档 FP16 可行性评测；候选保持 labs。本次正式发布的模型精度仍为 FP32。

六类独立示例固定到已公开的 0.3.0，发布验证继续覆盖当前打包 SDK 的消费者构建；自行集成新优化时使用上方 0.3.1 安装命令。公共 API 保持兼容。

## 模型、来源与许可

| 模型                | 状态与版本   | 精度 |   字节数 | SHA-256                                                            |
| ------------------- | ------------ | ---- | -------: | ------------------------------------------------------------------ |
| PicoDet-L-320 LCNet | 1.0.1 stable | FP32 | 23243834 | `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1` |
| PP-YOLOE+ S 640     | 0.1.0 stable | FP32 | 31954220 | `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c` |

模型均为 opset 11，npm 包不包含权重。Demo 默认 PicoDet，两个模型默认 ModelScope，来源选项只提供 ModelScope 与 Hugging Face。SDK 仓库清单默认 Hugging Face；显式选择来源失败不静默换源。

[PicoDet 清单](../../models/pp-detection/manifest.json)与[PP-YOLOE 清单](../../models/ppyoloe-plus-s-640/manifest.json)沿用相同字节、固定 revision 和 SHA-256。本次发布标签 v0.3.1 归档清单，不覆盖历史版本或重新上传模型。PP-YOLOE 的 ModelScope revision 是 `af865f1c515634de08fe0fc5eeeac8942456241c`，Hugging Face revision 是 `45a646ce13dcf2e2c05231954b1e32b9c412720b`；资产路径中的 0.1.0-labs.1 是历史固定目录，当前状态以 stable 清单为准。

模型来自 PaddleDetection 官方权重，PP-YOLOE 上游提交为 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，由 Paddle2ONNX 1.3.1 转换及定向修复。SDK、PaddleDetection、Paddle2ONNX 采用 Apache-2.0，ORT Web 1.27.0 采用 MIT。许可、模型来源及第三方声明见[模型卡](../../models/ppyoloe-plus-s-640/README.md)、[模型 LICENSE](../../models/ppyoloe-plus-s-640/LICENSE)和[THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md)。

## 后端与验证边界

SDK 支持 WASM/CPU、WebGPU 与 main/Worker。此次性能对照为 Windows 11 10.0.26200、Intel i5-10400F、NVIDIA Blackwell、Chromium 153.0.8010.12、ORT Web 1.27.0，FP32/main、WASM 单线程；热统计排除首张，初始化单独记录。PicoDet GPU 与两款 WASM 各一对，不能把单轮波动认定为稳定提速。

小米 15 证据为 Android Edge 152 的人工基础功能回归，没有旧版手机对照。实际 Android/HyperOS 版本未知，UA 中 Android 10 为缩减信息。没有新增峰值内存、Worker 性能或长时间视频吞吐结论；其他移动设备、Safari、Firefox 和微信 WebView 仍需独立验证。

FP16、INT8、INT4、FP8 未纳入本次稳定模型范围；微信原生小程序 JavaScript/WASM runtime 不支持。多线程 WASM 需要 COOP/COEP。当前已有的有日期验证范围见[兼容性](compatibility.md)；历史性能与实机报告保留原始版本身份。
