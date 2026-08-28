# 模型与精度

[English](../en/models.md)

当前仓库的 PicoDet-L-320 清单为 `models/pp-detection/1.0.0/manifest.json`，状态仍是
`labs/blocked`。仓库已有本地 FP32 ONNX 候选，并完成 CPU ORT parity；PaddleDetection
官方参考下载的字节数和 SHA-256 已核验，但 Git LFS、Hugging Face、ModelScope 三类
不可变分发来源和完整浏览器证据尚未完成，因此它还不是 SDK 默认加载的 stable 变体。
使用 SDK 时请传入已验证的 runtime manifest 或自定义模型清单。

| 变体            | 状态    | 说明                                                              |
| --------------- | ------- | ----------------------------------------------------------------- |
| FP32、FP16      | blocked | 需要真实 ONNX 文件、SHA-256、来源 revision 和浏览器验证后才能发布 |
| INT8、INT4、FP8 | labs    | 只有在精度、大小、内存和目标后端验证完成后才能标记 stable         |

manifest 中的 `precision` 区分 `fp32`、`fp16`、`int8`、`int4` 和 `fp8`，`quantization` 记录量化方法（例如 static-qdq）。SDK 只会选择清单中声明为 stable 且与后端匹配的变体；手动选择未验证组合会返回 `MODEL_INCOMPATIBLE` 或 `CAPABILITY_UNSUPPORTED`，不会静默替换。FP16、INT8、INT4 和 FP8 的大小、速度与精度都必须以实际导出和浏览器证据为准。

上游模型为 PaddlePaddle `PP-Detection_safetensors`，官方元数据声明 Apache-2.0。本项目的转换产物也按 Apache-2.0 分发；使用者仍应保留 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) 中的归属与引用。
