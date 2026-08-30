# 模型文件 / Model files

## 中文

本目录保存 PP-Detection 的版本化 ONNX 产物和由构建脚本生成的清单。当前默认
PicoDet 变体仍为 `labs/blocked`，仓库中的本地 FP32 ONNX 候选与 PaddleDetection
官方下载文件字节不一致；官方 URL、文档 revision、字节数和 SHA-256，以及候选
文件的大小和 SHA-256，见
`tools/model-pipeline/reports/picodet-source-evidence.json`。Git LFS、Hugging Face
和 ModelScope 均已有候选副本，ModelScope 固定提交和 SHA-256 已核验；1.0.1 FP32
候选已完成 Linux WASM 和 Windows NVIDIA WebGPU 的 7 张 fixture 验证，但来源许可、
FP16、移动端和微信 WebView 证据仍未完成，不能据此声明 stable 默认模型。验证索引见
`tools/model-pipeline/reports/1.0.1/remote-validation.json`。

### 默认清单状态

| 变体            | 状态    | 说明                                           |
| --------------- | ------- | ---------------------------------------------- |
| FP32、FP16      | blocked | 需要真实 ONNX、SHA-256、不可变来源和浏览器证据 |
| INT8、INT4、FP8 | labs    | 需要完成量化精度、大小、内存和后端验证         |

清单中的 `precision` 区分精度，`quantization` 记录量化方法。模型来源支持 Git LFS（默认）、Hugging Face、ModelScope 和 custom；只有资产和证据齐全的变体才能发布为 `stable`。不要把 Git LFS pointer 文件当作浏览器可用的模型本体。

### 生成清单

完成模型导出和验证后，在 `tools/model-pipeline` 中运行 `build_manifest`。生成器必须绑定实际文件字节数、SHA-256、opset、输入输出契约、不可变来源 revision 以及对应后端的浏览器证据；禁止手工填写或复制历史版本的数值。

### 来源与许可

转换输入来自 PaddlePaddle 的 [PP-Detection safetensors](https://huggingface.co/PaddlePaddle/PP-Detection_safetensors)。上游模型也见 [ModelScope](https://modelscope.cn/models/PaddlePaddle/PP-Detection)，项目实现与资料见 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)。根据官方模型元数据，模型以 Apache-2.0 许可提供。完整归属与论文引用见仓库根目录的 `THIRD_PARTY_NOTICES.md`。

## English

This directory contains versioned PP-Detection ONNX artifacts and generated manifests.
The default PicoDet variants remain `labs/blocked`. The reproducible local FP32 ONNX
candidate is not byte-identical to the official PaddleDetection download; its official
URL, documentation revision, size, and SHA-256, together with the candidate's size and
SHA-256, are recorded in
`tools/model-pipeline/reports/picodet-source-evidence.json`. Immutable Git LFS, Hugging
Face, and ModelScope distribution sources now contain the candidate, and the ModelScope
revision and SHA-256 have been verified. The 1.0.1 FP32 candidate has passed seven-fixture
validation on Linux WASM and Windows NVIDIA WebGPU, but source licensing, FP16, mobile
browser, and WeChat WebView evidence remain pending, so no stable bundled default is claimed.

The manifest distinguishes `fp32`, `fp16`, `int8`, `int4`, and `fp8`, with `quantization` recording the quantization method. Model distribution supports Git LFS (default), Hugging Face, ModelScope, and custom hosting. Git LFS, Hugging Face, and ModelScope now contain the same candidate bytes; only FP32 WASM/WebGPU evidence is complete, while source licensing, FP16, mobile browser, and WeChat WebView evidence remain pending. Only variants with complete assets and evidence may be released as `stable`; a Git LFS pointer is not a browser-runnable model.

After export and validation, run `build_manifest` from `tools/model-pipeline`. The generator must bind actual bytes, SHA-256, opset, tensor contracts, immutable source revisions, and browser evidence for each target backend; do not copy values from historical releases.

The upstream PaddlePaddle model is identified as Apache-2.0 by its official metadata. See `THIRD_PARTY_NOTICES.md` for attribution and citation details.
