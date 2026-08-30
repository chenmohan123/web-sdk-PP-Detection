# PP-PicoDet-L-320 1.0.1

该版本目前处于 `labs/blocked`。目录包含经过 WebGPU 兼容清理的 FP32 ONNX
候选 `picodet-l-320-fp32.onnx`，但三类不可变公共来源、WASM 和真实 NVIDIA
WebGPU 浏览器证据尚未全部完成，因此不能作为稳定默认模型使用。

候选模型大小为 `23243834` 字节，SHA-256 为
`0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。
清理只将 PicoDet 四个共享 `MatMul_0..3` 的 `auto_4_` 权重从 `[8]` 规范为
`[8,1]`，规避 ORT WebGPU 的 2D×1D MatMul 限制；输入输出契约、opset 和参数
数量保持不变。CPU parity 和清理结构证据分别见：

- `tools/model-pipeline/reports/1.0.1/fp32-cpu-parity.json`
- `tools/model-pipeline/reports/1.0.1/sanitize.json`

FP16 资产尚未在本版本生成。来源 revision、下载地址、字节数和 SHA-256 在
完成公共上传与回读核验后再写入 manifest；不要把本地文件直接当作已发布来源。
