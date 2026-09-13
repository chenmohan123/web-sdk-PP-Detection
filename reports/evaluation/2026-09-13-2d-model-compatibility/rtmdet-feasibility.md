# RTMDet 入口复核（2026-09-13）

在 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 和 `65e643573a35e068c796527648f7c2166de09cce` 的递归源码树中，对路径进行不区分大小写的 `rtmdet` 匹配，均未找到条目。两次响应的 `truncated` 都是 `false`，各含 2486 个条目；完整查询摘要见 [upstream-tree-scan.json](upstream-tree-scan.json)。

这仅说明本次固定版本的路径扫描没有找到入口，不证明所有历史分支、其他项目或 RTMDet 架构不能导出。官方 ONNX 支持表未单独列出模型，也不能作为不能转换的证据。

当前 `blocked` 仅指 PaddleDetection 来源入口未确定。恢复条件是找到明确配置、权重和导出链；若采用 MMDetection 版本，应作为独立来源重新评估，不套用 Paddle2ONNX 路径。本轮未转换或运行 RTMDet。
