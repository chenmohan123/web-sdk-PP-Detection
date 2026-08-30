# PP-PicoDet-L-320 1.0.1

该版本以 `fp32` 变体作为 stable 默认模型。目录包含经过 WebGPU 兼容清理的
`picodet-l-320-fp32.onnx`；GitHub LFS、Hugging Face 和 ModelScope 三类公共来源
均使用固定 revision，并完成字节和 SHA-256 回读。FP32 已在 Linux WASM 和
Windows NVIDIA WebGPU 上完成 7 张 fixture 的浏览器验证。

候选模型大小为 `23243834` 字节，SHA-256 为
`0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。
清理只将 PicoDet 四个共享 `MatMul_0..3` 的 `auto_4_` 权重从 `[8]` 规范为
`[8,1]`，规避 ORT WebGPU 的 2D×1D MatMul 限制；输入输出契约、opset 和参数
数量保持不变。CPU parity 和清理结构证据分别见：

- `tools/model-pipeline/reports/1.0.1/fp32-cpu-parity.json`
- `tools/model-pipeline/reports/1.0.1/sanitize.json`
- `tools/model-pipeline/reports/1.0.1/source-evidence.json`
- `tools/model-pipeline/reports/1.0.1/wasm-fp32.json`
- `tools/model-pipeline/reports/1.0.1/webgpu-fp32.json`
- `tools/model-pipeline/reports/1.0.1/remote-validation.json`

FP16、INT8、INT4、FP8 不属于本次 stable 发布；相关候选必须重新完成精度、大小、
内存、后端和浏览器证据后才能加入清单。移动端浏览器和微信 WebView 也未被本次
验证矩阵覆盖，因此不能据此宣称普遍兼容。
