# 0.3.2 发布说明

[简体中文](../zh-CN/release-0.3.2.md)

版本：`web-sdk-pp-detection@0.3.2`。日期：2026-09-12。

## 安装与变更

```bash
pnpm add web-sdk-pp-detection@0.3.2
```

- ONNX 权重下载默认每次请求总时限 180 秒、无新增字节时限 30 秒，最多重试 2 次；超时、下载和等待均可取消。
- `createPPDetection` 与 `ModelManager` 接受可选 `download` 配置。时间为 0 时关闭对应时限，`maxRetries: 0` 关闭重试；详见[API](api.md)。
- 仅网络/响应流故障、内部超时和 HTTP 408、429、500、502、503、504 重试同一固定 URL。取消、完整性失败、错误 206 和其他 HTTP 错误不重试，显式来源失败不静默换源。
- 每次完整重新下载，进度从 0 开始并附带 `attempt/maxAttempts`；只有字节数与 SHA-256 校验通过后才缓存，下载计时包含重试等待。清单 JSON 加载流程不变。
- 同步两模型六个稳定变体的文档和门户登记，新增[六变体消费者示例](../../examples/model-variants/README.md)。示例固定使用已验证的 npm 0.3.1 基础 API；使用新的下载策略时升级依赖至 0.3.2。

## 模型、来源与许可

本版沿用已发布的 [PicoDet 1.0.2 清单](../../models/pp-detection/1.0.2/manifest.json)和 [PP-YOLOE 0.1.1 清单](../../models/ppyoloe-plus-s-640/0.1.1/manifest.json)，不重新转换或上传模型。两份清单均默认 ModelScope/FP32，Demo 默认 PicoDet。用户可明确选择 ModelScope 或 Hugging Face；来源固定 revision、字节数与 SHA-256 由清单声明。npm 包不包含模型权重或内置默认清单。

| 模型            | 版本  | FP32 字节数 | FP16 字节数 | W8A32 字节数 |
| --------------- | ----- | ----------: | ----------: | -----------: |
| PicoDet-L-320   | 1.0.2 |    23243834 |    14813981 |      6117685 |
| PP-YOLOE+ S 640 | 0.1.1 |    31954220 |    16054567 |      8225467 |

模型来自 PaddleDetection 官方权重，使用 Paddle2ONNX 转换。SDK、PaddleDetection 与 Paddle2ONNX 采用 Apache-2.0，ORT Web 1.27.0 采用 MIT。详见[第三方声明](../../THIRD_PARTY_NOTICES.md)与[模型目录](../../models/README.md)。

## 后端与验证边界

SDK 支持 WASM/CPU、WebGPU 和 main/Worker。下载维护改动通过 193 项单元测试、12 项真实 HTTP/Chromium 下载恢复验证，以及两模型 W8A32 × WASM/WebGPU 的真实公开模型回归，见[维护验证记录](https://github.com/chenmohan123/chenmohan123.github.io/blob/ec0b530/reports/sdk-standard/2026-09-12-detection-download/README.md)。Windows 11、Chromium 153、物理 NVIDIA GPU 的桌面证据不代表所有设备。

FP16 与 W8A32 的识别与速度结论沿用[固定 64 图三精度对比](../../reports/evaluation/2026-09-12-precision-variants/README.md)，不是全量 COCO mAP。W8A32 的激活与卷积仍为 FP32，体积缩小不代表速度或内存同比改善。小米 15 既有人工验证只覆盖原 FP32；本版下载策略、新精度及其他移动设备尚无新增手机实测。

示例的公开 npm 0.3.1 外网验证保留一次 ModelScope 慢连接超时，明确改选 Hugging Face 后补齐剩余变体，不能写成全部 ModelScope 通过。微信原生小程序不支持 JavaScript/WASM runtime，多线程 WASM 依赖 COOP/COEP。版本发布与线上验收记录见[本版验收](../../reports/releases/2026-09-12-0.3.2/README.md)。
