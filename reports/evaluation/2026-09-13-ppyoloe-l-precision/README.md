# PP-YOLOE+ L 640 精度变体评估

日期：2026-09-13。对象为同一 PaddleDetection commit `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 导出的普通 PP-YOLOE+ L 640。评估使用固定 COCO val2017 64 张图片、716 条标注，桌面 Windows 11 Chromium 153、ONNX Runtime Web 1.27.0，WebGPU 物理 NVIDIA 适配器；Python 使用 ONNX Runtime 1.20.1 CPUExecutionProvider。

## 结果

| 变体      |  文件大小 | SHA-256            | Python AP | WebGPU AP |  相对 FP32 AP | 参考框匹配率（IoU≥0.99） |
| --------- | --------: | ------------------ | --------: | --------: | ------------: | -----------------------: |
| FP32 基线 | 209.18 MB | `01f325d2…7824075` |     51.31 |     51.31 |             — |                     100% |
| FP16      | 104.70 MB | `3f2545b9…cab96a2` |     51.42 |     51.47 | +0.11 / +0.16 |            85.0% / 54.1% |
| W8A32     |  52.70 MB | `e7e95c61…eeb5e03` |     51.33 |     51.33 | +0.02 / +0.02 |              6.3% / 6.3% |

AP 为固定子集的百分制 COCOeval，不能外推全量 COCO。FP16 保留 ReduceMean 为 FP32；W8A32 仅压缩卷积权重，激活与卷积计算保持 FP32。

## 接入判定

两种变体均能在 Python 和桌面 WebGPU 完成识别，模型体积分别减少约 49.9% 和 74.8%。但当前稳定门槛要求与 FP32 参考在 IoU≥0.99、score≥0.5 下至少匹配 95% 检测框；FP16 和 W8A32 均未达到该门槛。因此本轮只记录为 `labs` 评估，不写入稳定 manifest、Demo 或门户稳定登记。后续可在放宽逐框门槛并补充更大样本、WASM/Worker 和来源许可证据后复查。

## 证据

- `fp16-conversion.json`、`w8a32-conversion.json`：转换器版本、opset、权重统计和 SHA-256。
- `fp16-runtime.json`、`w8a32-runtime.json`：64 图 Python 质量和耗时。
- `browser-fp16-webgpu.json.gz`、`browser-w8a32-webgpu.json.gz`：64 图真实 WebGPU 推理、实际后端、逐图耗时和预测。
- `comparison.json`：Python/WebGPU AP 与逐框匹配汇总。

模型仍未建立官方 ModelScope/Hugging Face 固定分发 revision；不上传权重、不修改当前稳定模型和默认来源。
