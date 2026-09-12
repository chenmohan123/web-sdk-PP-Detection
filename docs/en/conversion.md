# Model conversion

[中文](../zh-CN/conversion.md)

The conversion tools live in `tools/model-pipeline` and require Python 3.11. They export an opset 18 FP32 ONNX graph from safetensors, run graph/numeric/detection parity, produce an FP16 candidate, validate variants, and build the manifest. Do not hand-edit `manifest.json`.

```powershell
Set-Location tools/model-pipeline
python -m ppdetection.inspect_model
python -m ppdetection.export_fp32
python -m ppdetection.validate
python -m ppdetection.convert_fp16
python -m ppdetection.variant_validation
python -m ppdetection.build_manifest
```

Use each module's `--help` for exact local model paths and arguments. Validation reports bind source and ONNX SHA-256 values, opset, tensor names/shapes, detection matching, and browser runtime evidence. Only accepted variants may enter the manifest.

## Current asset status

The repository now contains a reproducible PicoDet-L-320 FP32 stable ONNX asset at
`models/pp-detection/picodet-l-320-fp32.onnx`. Graph inspection reports
`23,243,834` bytes, `5,787,988` parameters, and opset 11. CPU ORT parity passes on
seven fixtures; hashes, preprocessing, and error metrics are recorded in
`tools/model-pipeline/reports/picodet-parity.json`.

The stable asset is recorded in immutable Git LFS, Hugging Face, and ModelScope
distribution sources with immutable source revisions, download URLs, byte sizes, and SHA-256 values in
`tools/model-pipeline/reports/picodet-source-evidence.json`. One Windows HeadlessChrome WASM/CPU smoke test is recorded in
`tools/model-pipeline/reports/picodet-browser-evidence.json`; WebGPU had no available
adapter in that run, while mobile, WeChat WebView, and other browsers remain unverified;
source licensing verification is still pending. 以上内容是 1.0.1 FP32 的历史生成证据。当前 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 已发布 FP32、FP16、W8A32 六个 stable 变体；FP16/W8A32 的证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图，移动端和微信 WebView 仍需独立验证。

After official weights are exported, produce evidence for each FP32, FP16, INT8, INT4, or FP8 variant in this order: graph inspection, CPU numeric/detection parity, browser WASM and WebGPU validation, ONNX SHA-256 and immutable-source checks, then `build_manifest`. Mark a variant `stable` only when its evidence is complete and its target backend passes.

## 第二模型历史评测

PP-YOLOE+ S 的实际转换入口位于 `tools/model-pipeline/ppyoloe/`，使用固定的官方 PaddleDetection 源码、Paddle 导出与 Paddle2ONNX opset 11。0.1.0 的来源、COCO 子集、原 Paddle 与 ONNX 对齐和浏览器结果见[2026-09-11 报告](../../reports/evaluation/2026-09-11-ppyoloe/README.md)；当前 0.1.1 三精度结果见[2026-09-12 报告](../../reports/evaluation/2026-09-12-precision-variants/README.md)。
