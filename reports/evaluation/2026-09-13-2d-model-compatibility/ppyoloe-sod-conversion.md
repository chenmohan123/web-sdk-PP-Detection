# 任务 2：PP-YOLOE-SOD 转换可行性评估（2026-09-13）

PP-YOLOE-SOD 在 PaddleDetection `develop` 配置树中存在，固定配置提交为 `ad4c52eac56fad3303169d02c6f6578abbdcf106`。配置确认了 PPYOLOEHead、MultiClassNMS 和训练输出目录，但只引用本地 `model_final`，没有固定公开权重 URL、输入 shape 或 ONNX 输出签名。

官方 `deploy/EXPORT_ONNX_MODEL_en.md`（`develop` 提交 `e1f4027833973a9c37fb9f144e77beeead3acb41`）的支持表列出 PP-YOLOE，但没有列 PP-YOLOE-SOD，并要求导出时固定输入 shape。因此当前无法给出可复现的 Paddle2ONNX 转换命令，也无法生成 Python ONNX Runtime 参考输出。

按计划将 PP-YOLOE-SOD 标记为 `blocked`，不修改 runtime、manifest、Demo 或稳定模型。下一候选转为 RTMDet tiny；只有取得固定权重、许可证、输入输出契约并完成导出后，PP-YOLOE-SOD 才能恢复评估。

证据文件：`ppyoloe-sod-upstream.yml`、`export-onnx-upstream.md`、`paddledetection-license.txt`、`ppyoloe-sod-conversion.json`。
