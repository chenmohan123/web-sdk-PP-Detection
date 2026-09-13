# PP-YOLOE+ SOD L 640 COCO 转换评估（2026-09-13）

## 固定来源

- PaddleDetection commit：`b25522a0f4bde8c80603f3ba5e3472059972e3b5`，commit tree：`7d7b4c0ca5a9b2b2398409959100d99ff35dfe15`。
- 配置：`configs/smalldet/ppyoloe_plus_sod_crn_l_80e_coco.yml`；官方模型表提供 `https://paddledet.bj.bcebos.com/models/ppyoloe_plus_sod_crn_l_80e_coco.pdparams`。
- 权重：351,463,346 字节，SHA-256 `6982308d871e0d4285dc8577814409b077ef947fef9d59ef6497b86f9f153e87`。
- 原文快照、文件 blob SHA-1、下载摘要和许可证状态见 `sources.lock.json`；快照使用 gzip 保存，未改写上游原文。

## 转换与修正

在 Python 3.11.15、PaddlePaddle 2.6.2、Paddle2ONNX 1.3.1、ONNX 1.16.2、ONNX Runtime 1.20.1 环境执行官方 `tools/export_model.py`，固定 `TestReader.inputs_def.image_shape=[3,640,640]`，再运行 Paddle2ONNX opset 11。原始 ONNX 通过 `onnx.checker`，但 ONNX Runtime 形状推断因 `Squeeze.4`/`Squeeze.6` 缺少 axes 失败。复现脚本只在原始 SHA-256 匹配时，为这两个已核对节点加入 `axes=[1]`，并将 `scale_factor` 固定为 `[[1,1]]`、batch 固定为 1；没有修改其他图结构。

准备后的模型输入为 `image float32 [1,3,640,640]`，输出为 `float32 [N,6]` 和 `int32 [1]`，opset 11。模型 345,644,377 字节，SHA-256 `a8fb0978485d42f78346339490302e4f3116daa2cdc7c192b2e2250b1675cd2e`。

## 结果

- Paddle 与 Python ONNX Runtime：固定 COCO 子集 64 张图、531 个阈值以上检测框全部匹配；最大 score 差 `2.68e-6`，最大框坐标差 `0.000184` 像素，空检测结果一致。
- Chromium WASM/main：8 张图全部运行，49 个阈值以上检测框全部匹配，最大框坐标差 `0.000117` 像素；首图约 5.9 秒，热身后中位约 5.84 秒。
- Chromium WebGPU/main：8 张图全部运行，49 个阈值以上检测框全部匹配，最大框坐标差 `0.000412` 像素；首图约 2.04 秒，热身后中位约 110 ms。运行日志提示部分节点未分配到首选执行提供程序，未采集逐节点分配。

浏览器逐框比较采用 Python ONNX Runtime + Pillow BICUBIC 预处理参考；Paddle 原模型比较采用 OpenCV INTER_CUBIC。两者分别验证预处理语义，不能混为同一参考。WebGPU 警告只说明部分节点不由首选执行提供程序运行，未记录逐节点分配，不能断言具体哪些节点在 CPU。

原始日志、预测、清单和浏览器报告以 gzip 证据存档并由 `evidence-index.json` 校验。当前结论是 `selected`：允许进入浏览器专项验证，不修改 runtime、manifest、Demo 或稳定模型。

复现入口：`reproduction/export_sod.py`、`reproduction/prepare_sod.py`、`reproduction/summarize.py`。

完整准备与运行命令见 [复现说明](reproduction/README.md)。
