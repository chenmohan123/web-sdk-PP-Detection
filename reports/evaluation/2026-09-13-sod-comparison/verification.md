# 验收记录（2026-09-13）

本轮为单 SDK 候选研究与报告变更，基线 `28db99e`。完整原始输出按摘要归档，不将候选写入稳定 manifest。

| 检查                | 命令或证据                                                                             | 结果                                                 |
| ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 修改前 SDK 标准检查 | 门户执行 `pnpm sdk:check -- --repo .worktrees/detection-sod-comparison --format table` | required 失败 0，远程规则 skip 4                     |
| 修改后 SDK 标准检查 | 同一检查器输出 [standard-after.json](standard-after.json)                              | locally-compliant，required 失败 0，远程规则 skip 4  |
| SDK 全部单测        | SDK 子包内 `node node_modules/vitest/vitest.mjs run`                                   | 21 文件、206 项通过                                  |
| SDK 构建            | SDK 子包内 `node node_modules/tsup/dist/cli-default.js --config tsup.config.ts`        | ESM、浏览器 IIFE、Worker、类型声明均成功             |
| 文档契约            | `node --test scripts/check-doc-parity.test.mjs`                                        | 5 项通过                                             |
| 浏览器评测工具契约  | `node --test tools/model-pipeline/browser/evaluation-runner.test.mjs`                  | 5 项通过                                             |
| 真实浏览器          | [summary.json](summary.json) 与 [evidence-index.json](evidence-index.json)             | 两模型 WebGPU 各 64 图、WASM 各 8 图，实际后端无回退 |
| 官方转换参考        | [summary.json](summary.json) 的 ordinaryPaddleParity                                   | 533/533 阈值以上框匹配                               |
| 浏览器参考          | summary 中的四份 parity                                                                | 两模型两后端均零未匹配框                             |
| 离线证据重算        | `python reports/evaluation/2026-09-13-sod-comparison/summarize.py --verify-only`       | 压缩/原始摘要、COCOeval、逐框对齐、上游快照全部通过  |
| 脚本语法            | Python `ast.parse`；PowerShell `Parser.ParseFile`                                      | 全部通过                                             |
| 文档格式            | 仓库 Prettier 检查变更 Markdown；JSON 按现有 ignore 保留原始字节                       | 通过                                                 |
| 差异空白            | `git diff --check`                                                                     | 通过                                                 |

浏览器使用固定生成的无损 PNG；用于保证跨环境输入像素一致，不宣称 JPEG 解码性能。WASM 仅 8 图；WebGPU 64 图和 Python 64 图用于正式同规模比较。手机未新增验证，继续使用桌面优先策略。

分发审查只读核对公开来源，当前没有正式固定镜像，也没有新的权重许可适用范围证明。模型卡为草稿，不宣称已经发布。独立源码 Apache-2.0 和 COCO 标注/图片各自条款分别归档。

执行中的环境说明：普通 `git status` 在本工作树触发已存在的 LFS 对象清理时可能因 SDK 主仓库 `.git/lfs/tmp` 权限报错，Git 元数据操作复用宿主权限；未修改全局 Git/LFS 配置。无 UI 或产品逻辑改动，门户本轮只提供标准检查，不重新登记候选模型。
