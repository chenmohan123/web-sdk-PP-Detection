# 复现说明

本目录相对路径均从 SDK 根目录执行。需要先按 [SOD 转换复现](../2026-09-13-2d-model-compatibility/reproduction/README.md) 准备固定源码、SOD ONNX、64 图与 Python 3.11 环境。`--cache-root` / `-SdkCache` 指向保存这些 `.tmp/phase2` 和 `.tmp/sod-20260913` 文件的 SDK 根目录，可与当前工作树相同。

Node 依赖执行 `pnpm install --frozen-lockfile`，SDK 构建执行 `pnpm build`。本轮复用主仓库的锁定依赖；本工作树实际构建命令为在 `packages/sdk` 运行 `node node_modules/tsup/dist/cli-default.js --config tsup.config.ts`。浏览器需要当前锁文件对应的 Chromium，设置 `PLAYWRIGHT_BROWSERS_PATH` 指向缓存目录后执行 `pnpm exec playwright install chromium`。

```powershell
# 本次实际复用缓存路径；其他机器改为本机 SDK 根目录。
./reports/evaluation/2026-09-13-sod-comparison/run_comparison.ps1 -SdkCache 'F:/git/00_chenmohan/github/web-sdk-PP-Detection'
```

脚本会下载约 216.7 MB 普通 L 权重，已有文件则由导出脚本校验 SHA-256 后复用，不覆盖不同内容。固定上游配置和权重锁见 [reference-source.json](reference-source.json)，原始 ONNX 的摘要在图准备后验证。只支持本次转换工具链，摘要不同应停下核对，不能使用新输出冒充本次模型。

脚本依次执行普通 L 导出/转换、模型与 64 图哈希核验、Python OpenCV/Pillow 推理、Paddle 参考、WebGPU 64 图、WASM 8 图，最后归档并重算校验。脚本按阶段检查退出码，失败时停止；不要并行运行两模型基准。汇总脚本要求实际 GPU、模型/清单/SDK 摘要、图片顺序和逐框匹配均正确，才写成功报告。重跑的时间记录会形成真实文档变更，审阅后再提交。

无 GPU 或没有模型本体时，仍可离线核验已提交证据：使用锁定 Python 依赖运行 `python reports/evaluation/2026-09-13-sod-comparison/summarize.py --verify-only`。该模式不下载、不写报告，从压缩预测重新执行 COCOeval 与逐框匹配，并检查上游快照和文件摘要。分发平台搜索是带日期的历史观察，不参与本地可复现模型指标，不能推断平台未来状态。
