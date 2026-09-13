# 发布验证

日期：2026-09-14，SDK 0.4.0。本次发布只新增模型清单、Demo 选择项、转换规格和证据，不修改 runtime API。

- 固定权重：M/L/X × ModelScope/Hugging Face 六个文件完整回读通过，详见 `downloads.json`。
- 数值：Paddle→ONNX64图和浏览器后端逐框核验通过，压缩原始证据与 COCO 重算见 `summary.json`。
- 生命周期：S/M/L/X × WASM/WebGPU × main/worker16组通过，详见 `desktop-smoke.json`。
- 标准基线：`ff663002923fafe8cb5de5514bc779c3b05c4585` 的干净源码快照检查通过。历史 `.tmp` ACL 使原目录扫描失败，未修改其访问权限。
- 最终源码快照标准检查通过；原目录的全量格式遍历同样受到历史 `.tmp` ACL 限制，格式检查在干净源码快照执行。
- SDK 单测 206 项、Demo 模型与精度回归 11 项、benchmark parity14项全部通过；文档5项、示例12项、发布29项、benchmark契约6项通过。
- SDK 与 Demo 的 lint、typecheck 和构建通过。仓库 `verify` 的除全目录格式扫描外各步骤均在原目录完整执行，CI 将从干净检出运行全部 `verify`。
- PP-YOLOE 导出、来源和 ONNX 契约相关 Python 测试 25 项通过。模型流水线全目录测试因本环境缺少其他模型使用的 torch / onnxconverter_common 而未完成收集，不据此声称全套通过。
- 独立只读审查通过，未发现阻塞项。合并与线上部署以 GitHub PR/Actions 的最终记录为准。

验证只覆盖记录中的桌面环境；没有新增移动设备或微信兼容结论。
