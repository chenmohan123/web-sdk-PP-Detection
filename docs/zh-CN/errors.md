# 错误码

[English](../en/errors.md)

运行时错误消息保持英文，业务界面应使用稳定的 `PPDetectionError.code` 本地化。以下表格由 `docs/error-codes.json` 作为单一数据源维护：

| 错误码                     | 含义                                         | 建议处理                                                             |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `CAPABILITY_UNSUPPORTED`   | 当前浏览器不具备所需的 WebGPU 或 WASM 能力。 | 升级浏览器，改用 WASM，或检查安全上下文。                            |
| `INVALID_INPUT`            | 图片、视频帧或其他输入格式无效。             | 使用有效的 Blob、Canvas、ImageData、HTMLVideoElement 或 VideoFrame。 |
| `INVALID_MANIFEST`         | 模型清单结构、版本或字段无效。               | 按模型清单契约修正 JSON，并检查 minSdkVersion。                      |
| `MODEL_DOWNLOAD_FAILED`    | 模型或清单下载失败。                         | 检查 URL、网络、HTTPS、CORS 和响应状态。                             |
| `MODEL_INTEGRITY_FAILED`   | 模型大小或 SHA-256 与清单不一致。            | 清除缓存并从可信固定版本地址重新下载。                               |
| `MODEL_INCOMPATIBLE`       | 没有与所选后端和精度兼容的模型变体。         | 允许自动回退，或提供兼容的 FP32/FP16 变体。                          |
| `MODEL_SOURCE_UNAVAILABLE` | 模型来源不可用或未声明可下载资产。           | 检查来源类型、revision、URL、CORS 和模型清单。                       |
| `SESSION_CREATE_FAILED`    | ONNX Runtime 会话创建失败。                  | 检查模型算子、WASM 资源路径，并尝试允许回退。                        |
| `DISPOSED`                 | 检测器已经释放，不能继续执行操作。           | 创建新的检测器，并在生命周期结束时只释放一次。                       |
| `INFERENCE_FAILED`         | 推理或已释放检测器上的操作失败。             | 检查 details、输入尺寸和生命周期，并重新创建检测器。                 |
| `OUT_OF_MEMORY`            | 浏览器内存不足。                             | 释放旧检测器、关闭其他页面、使用 FP16 或在桌面端运行。               |
| `ABORTED`                  | 加载或检测被 AbortSignal 取消。              | 仅在需要时重试，并为新操作创建新的 AbortController。                 |

```ts
import { PPDetectionError } from "web-sdk-pp-detection";

export function errorLabel(error: unknown): string {
  if (!(error instanceof PPDetectionError)) return "UNKNOWN";
  return `${error.code}: ${error.message}`;
}
```
