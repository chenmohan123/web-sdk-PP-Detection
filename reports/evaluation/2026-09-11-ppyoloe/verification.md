# 本轮验收与集成记录

日期：2026-09-11。以仓库根目录执行，Python 使用 `.tmp/phase2/venv/Scripts/python.exe`。本轮修改保留在 `codex/ppyoloe-evaluation-baseline`，没有提交或远程发布。

## 验收结果

| 验证                                                                                                                                                                                                 | 结果                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                                                                                                                          | 19 个文件、136 项通过                                                                  |
| `pnpm typecheck`、`pnpm lint`、`pnpm build`                                                                                                                                                          | 通过                                                                                   |
| `pnpm docs:test`、`pnpm examples:check`                                                                                                                                                              | 5 / 10 项通过                                                                          |
| `pnpm release:test`、`pnpm benchmark:test`                                                                                                                                                           | 20 / 6 项通过                                                                          |
| `python -m pytest tools/model-pipeline/tests/test_detection_evaluation.py tools/model-pipeline/tests/test_ppyoloe_pipeline.py -q -p no:cacheprovider --basetemp .tmp/phase2/pytest-final-integrated` | 36 项通过                                                                              |
| `node --test tools/model-pipeline/browser/evaluation-runner.test.mjs`                                                                                                                                | 4 项通过                                                                               |
| `node node_modules/playwright/cli.js test tests/browser/benchmark-parity.spec.ts tests/browser/picodet.spec.ts`                                                                                      | 15 项通过、1 项因该默认 headless 环境无 adapter 跳过；物理 WebGPU 另由正式 runner 验证 |
| 两模型 × WASM/WebGPU 正式 runner                                                                                                                                                                     | 每组 64 张全部通过，实际后端匹配、回退为 0；摘要见 summary.json                        |
| 修改前后 `pnpm sdk:check -- --repo ../web-sdk-PP-Detection --format json`                                                                                                                            | required 通过 18、失败 0、远程项 skip 4，locally-compliant                             |

`pnpm format:check` 的全目录扫描被历史 `work/pytest-task2-review` 和 `.pytest_cache` 目录权限阻止。随后使用 Git 可见文件清单、同一 `.prettierignore` 与 Prettier 配置逐文件检查，258 个文件全部通过，记录见 `format-check.json`。未为格式检查修改或删除历史缓存目录。

完整历史 model tests 的收集需要 `torch` 与 `onnxconverter-common`，本轮专用环境没有安装这两个旧版面/FP16 流程依赖，因此未取得该历史全集通过结论。新的检测评测与 PP-YOLOE 测试完整执行。旧 FP16 测试即使通过，也不用于证明本轮候选兼容性。

## 复现核验

正式 `ppyoloe/export.py` 从锁定权重再次导出到 `.tmp/phase2/reproduction/exported`，接着运行定向修复。原 ONNX SHA-256 再次得到 `fe8092f2d62f50c74ce3b6b6cb9e40817fb1c49e4fd4e9b88dfd1222d984d012`，候选再次得到 `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c`，与首次产物相同。

正式 `paddle_reference.py` 在相同 64 张图片上重新运行成功，模型及参数摘要、COCOeval 和逐图匹配保存在 `paddle-reference-runtime.json`。正式 `inference.py` 的 Pillow 路径也已重新运行，预测与归档结果比较后核验。

重建版 annotations 保留官方图片顺序，探索期输入按 ID 排序；按图片和检测内容排序后，两次 Paddle 及 Pillow ORT 的各 19,200 条预测完全相同，见 `reproduction.json`。正式四组浏览器测量均使用同一归档顺序。

原始像素诊断的脚本保存在 `diagnostics/`；这是定位 JPEG 解码差异的实验快照，正式评测仍使用通用 browser runner。复现诊断前按模型指南准备原 `.tmp/phase2` 布局，再执行：

```powershell
& .tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-11-ppyoloe/diagnostics/prepare_rgba.py
$env:PLAYWRIGHT_BROWSERS_PATH = ".tmp/dependencies-compatible-browsers"
node reports/evaluation/2026-09-11-ppyoloe/diagnostics/pixel-input.mjs webgpu ppyoloe --raster
```

## 审查与修正

评测工具的独立任务审查发现：等 IoU 匹配在交换输入顺序后可能改变匹配对象。已用回归测试复现，再按检测内容规范排序后分配；原始索引仍可用于溯源，修复测试通过。

集成审查补齐了未知 Squeeze 属性拒绝、浏览器标签名称/顺序校验、导出前权重与关键配置校验、同一 Python 环境中的 Paddle2ONNX 路径，以及完整导出依赖快照。回归测试分别先验证失败再通过，错误权重通过实际 CLI 被拒绝，完整官方导出随后成功。

原始 COCO 类别保存在数据集 categories，SDK manifest 继续只按该顺序声明 labels。报告保留默认 Chromium 启动参数、物理适配器字段和 ORT 的节点分配警告；不将这些警告误写成整次推理回退。

## 实施取舍

- 使用干净基线上的独立功能分支复用大模型与依赖，没有新建 worktree；代价是与原检出共享目录。
- 中文任务标题由 PowerShell 提取任务简报；英文文档入口同步链接中文候选说明，遵循本轮中文文档要求。
- SDK 用默认关闭的 `allowExperimental` 接入 labs，避免改变候选状态；代价是该选项需要后续 SDK 发布才能供 npm 用户使用。
- 保留本地未提交结果及过程记录，方便审阅；公开分发、移动设备验证和稳定发布仍是后续阶段。
