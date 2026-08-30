# PP-PicoDet-L-320 1.0.1

该版本目前处于 `labs/blocked`。目录包含经过 WebGPU 兼容清理的 FP32 ONNX
候选 `picodet-l-320-fp32.onnx`。GitHub LFS、Hugging Face 和 ModelScope 三类
公共来源已经上传并完成固定 revision 和字节回读。FP32 已在 Linux WASM 和
Windows NVIDIA WebGPU 上完成 7 张 fixture 的浏览器验证；FP16、移动端和微信
WebView 证据仍未完成，因此本版本不能作为稳定默认模型使用。

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

FP16 资产尚未在本版本生成。来源 revision、下载地址、字节数和 SHA-256 在
来源证据中记录；manifest 仍待 FP16、移动端和微信 WebView 证据完成后再生成稳定变体。
