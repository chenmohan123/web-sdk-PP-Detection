# 0.2.0 发布说明

[English](../en/release-0.2.0.md)

版本：`web-sdk-pp-detection@0.2.0`。日期：2026-09-08。

## 安装

```bash
pnpm add web-sdk-pp-detection@0.2.0
```

## 变更

- 新增按 `{ id, version }` 查询/清理缓存的 `ModelManager.getCacheEstimate(model?)`、`clearCurrentModelCache(model?)`，以及可选的 `ModelCache.scope`、`list()`。容量按键去重，自定义缓存缺少 `list()` 时拒绝按模型操作，避免扩大清理范围。
- 新增 `loadTimings.modelSource` 与 `runtime.runtimeVersion/environment`；初始化计时包含 manifest 获取、完整性校验和 Worker 启动，结果保留当次实际后端快照。
- 修复缓存清理期间的迟到写入与共享管理器竞态、Worker 输入转移后的 WASM 回退，以及 Demo 连续媒体会话复用和旧配置帧调度。
- 文档更正：`createPPDetection` 必须显式传入 `model` 或 `manifest`，缺省时抛出 `INVALID_MANIFEST`。npm 包不包含 ONNX 模型本体。

新增 API 从 0.2.0 起提供，完整契约见 [API](api.md)与[性能语义](performance.md)。

## 模型、来源与许可

沿用 PicoDet-L-320 LCNet `pp-picodet-l-320@1.0.1`、FP32、ONNX opset 11、5,787,988 参数。默认变体 `fp32`。资产 `picodet-l-320-fp32.onnx` 为 **23,243,834 字节**，SHA-256 为 `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。

仓库模型 manifest 默认来源为 **Hugging Face**；在线 Demo 的来源选择默认设为 **ModelScope**，两者分别属于模型清单和 Demo 配置。

[模型 manifest](../../models/pp-detection/manifest.json)记录下列不可变分发 revision；三份文件大小和 SHA-256 相同。显式选源失败不会静默换源，只有 `auto` 才会尝试清单声明的替代来源。

| 来源                          | 仓库                                | 固定 revision                              |
| ----------------------------- | ----------------------------------- | ------------------------------------------ |
| Hugging Face（manifest 默认） | `chenmohan/web-sdk-pp-detection`    | `df2b6b79ccdadbaa84fc56ef66369c7cf5cdacff` |
| ModelScope（Demo 默认）       | `chenmohan/web-sdk-pp-detection`    | `852b3acbb768705c77359362546eae9999f4190c` |
| Git LFS                       | `chenmohan123/web-sdk-PP-Detection` | `f7369860bffbb18a6b850987bab3943e1abb2b12` |

模型源自 PaddleDetection release/2.9 的 PicoDet-L-320 LCNet，经 Paddle2ONNX 转换和后处理 ONNX 清理。SDK 与 PaddleDetection/Paddle2ONNX 代码采用 Apache-2.0，模型许可依据上游官方模型说明；ONNX Runtime Web 1.27.0 采用 MIT。COCO 标签、数据集及权重的再分发条件按[第三方声明](../../THIRD_PARTY_NOTICES.md)分别核对；分发平台不改变上游许可，npm tarball 不含模型二进制。

## 后端与验证边界

支持 ONNX Runtime Web 1.27.0 的 WASM（CPU）和 WebGPU、main/Worker 模式。自动后端优先 WebGPU，运行时回退需要显式设置 `allowFallback: true`；手动选择的后端和精度必须符合清单。多线程 WASM 要求 COOP/COEP，单线程不要求跨源隔离。

真实模型证据日期为 **2026-08-30**，覆盖七张 fixture：Chromium 151.0.7922.34 / Linux 6.17.0-1022-azure / GitHub Actions runner / WASM，以及 Chromium 151.0.7922.174 / Windows 10.0.26200 / NVIDIA Blackwell / WebGPU。该证据验证 PicoDet 1.0.1 FP32 资产，详见[兼容性](compatibility.md)。0.2.0 包的类型、安装、构建及 main/Worker 生命周期验证见 [2026-09-08 发布定稿核验](../reviews/2026-09-08-npm-0.2.0-finalization.md)；确定性微型 ONNX fixture 验证包消费和生命周期，不构成真实模型精度或性能基准。

FP16 为 blocked，INT8/INT4/FP8 为 labs；FP64 不支持。移动浏览器、Android/iOS 微信 WebView、Safari 和 Firefox 尚无独立兼容性证据；桌面窄屏模拟不是移动设备证据。跨标签页/Worker 的并发缓存协调不在保证范围内。摄像头权限、视频循环、帧率控制和结果绘制由宿主页面负责；微信原生小程序 JavaScript/WASM runtime 不支持。
