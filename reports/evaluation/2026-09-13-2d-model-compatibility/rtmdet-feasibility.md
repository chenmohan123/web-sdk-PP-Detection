# RTMDet 复核（2026-09-13）

在 PaddleDetection 官方 `develop` 递归源码树中搜索 `rtmdet`，结果为 0 个配置或实现文件。当前仓库的官方 ONNX 导出支持表也没有 RTMDet 条目，因此不能从 PaddleDetection 固定出可复现的 RTMDet tiny 转换路径。

按兼容矩阵门槛，RTMDet tiny 标记为 `blocked`，不修改 SDK。后续只有找到明确的 PaddleDetection 上游配置、固定权重、许可证和导出证据后才恢复评估。
