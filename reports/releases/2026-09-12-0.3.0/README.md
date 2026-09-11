# 0.3.0 发布记录

日期：2026-09-12（北京时间）。范围：PP-Detection 单 SDK、模型清单及独立 Demo。

本记录按门户 `standards/v1/templates/release-checklist.md` 整理。模型、许可、来源及兼容性边界见[发布说明](../../../docs/zh-CN/release-0.3.0.md)。历史评测、分发和小米 15 记录保持原样。

## 发布前验证

- [x] 版本、中文 README 入口、双语文档入口、npm 元数据和 CHANGELOG 已同步为 0.3.0。
- [x] SDK：136 项测试，typecheck、lint 和构建通过。
- [x] Demo：69 项浏览器回归、typecheck、lint 和生产构建通过。
- [x] 独立 npm pack 安装消费：4 项通过；WASM 生命周期：1 项通过；benchmark parity：14 项通过。
- [x] 文档、examples、benchmark 及浏览器评测工具契约：25 项通过；发布、依赖与仓库契约：20 项通过。
- [x] 新增 Python 评测和 PP-YOLOE 工具：36 项通过。
- [x] 固定 PicoDet 模型校验通过；两模型资产的版本、来源 revision、字节数和 SHA-256 已归档。
- [x] SDK 标准检查：18 项 required 通过、0 项失败；4 项远程规则由 GitHub API 另行核验。
- [x] GitHub About、Pages 配置、main 及发布标签 Ruleset 已核验，见 [governance.json](governance.json)。
- [x] 本机生产预览四条真实推理路径及 1440/390 布局通过，见 [preflight.json](preflight.json)。GPU 为物理 NVIDIA Blackwell，后端无回退。

发布预检发现并修复了一处 Demo 时序问题：检测结果显示后，缓存统计尚未结束，快速切换后端并开始检测会被旧任务的防重入逻辑忽略。新增测试延迟真实 IndexedDB 事务完成通知，先复现按钮错误可用，再验证修复后按钮等待任务结束且能够立即重新检测。两次修复前失败记录保留在本地 `.tmp/release-0.3.0-preflight` 和 `.tmp/release-0.3.0-preflight-diagnostic`；没有把它们误记为模型或 GPU 推理失败。

本地检查覆盖 `pnpm verify` 的脚本及本轮相关验证。当前 Windows 工作区存在无权读取的历史临时缓存，格式检查按 Git 可见文件运行同一 Prettier 配置；仅在脚本运行环境关闭 pnpm 的隐式依赖刷新，未修改项目依赖配置。CI 在干净 checkout 中运行完整 `pnpm verify`。

可复现命令：

```powershell
pnpm verify
pnpm --filter demo typecheck
pnpm --filter demo build
pnpm --filter demo test
pnpm exec playwright test tests/browser/runtime.spec.ts --grep "browser WASM"
pnpm exec playwright test tests/browser/package.spec.ts
node --test tools/model-pipeline/browser/evaluation-runner.test.mjs
python -m pytest tools/model-pipeline/tests/test_detection_evaluation.py tools/model-pipeline/tests/test_ppyoloe_pipeline.py
node scripts/verify-release.mjs --models 1.0.1
```

标准检查从门户运行：`pnpm sdk:check -- --repo ../web-sdk-PP-Detection --format json`。本次完整结果见 [sdk-standard.json](sdk-standard.json)。本地补充证据位于忽略目录 `.tmp/release-0.3.0-*` 和 `.tmp/result-panel-preview/verification.json`；这些临时路径不作为公开兼容性证据。

## 远程发布与线上验收

发布准备提交时，PR、npm 和线上部署尚未执行；发布后的执行状态以 GitHub Actions、npm registry 和 GitHub Release 附件为准。

1. 通过 PR 合并 main，要求最新提交的 `Validate workspace` 和 `Browser WASM and package smoke` 均通过。
2. 在 main 合并提交创建不可变 `v0.3.0` 标签，经 `npm release` 工作流使用 Trusted Publishing 和 provenance 发布。
3. 核验 GitHub Pages 成功部署记录及源码提交、npm 版本/完整性/provenance，再基于已有标签创建 GitHub Release。
4. 执行 `node reports/releases/2026-09-12-0.3.0/verify-live.mjs`，在真实线上 Demo 验证两模型各自的 ModelScope 下载、WASM/WebGPU 推理和 1440/390 宽度布局；上传结果作为发布附件。

验收脚本不拦截模型请求、不替换推理结果，要求后端无回退、存在检测结果，检查两来源及默认 ModelScope、选中/取消不移动画布，以及示例卡片只显示图片。首次编译 WebGPU 管线可能较慢，脚本为每次检测预留 120 秒。

main Ruleset 为 `21779070`，发布标签 Ruleset 为 `21779094`，均无绕过主体。Pages 使用 GitHub Actions、`github-pages` 环境和 HTTPS。必需 CI 与发布使用 GitHub 托管 runner；可选硬件 GPU runner 位于 `F:\github-runner\web-sdk-PP-Detection`。

本次桌面浏览器验证和既有小米 15 用户反馈仅代表有日期记录的环境，不扩展为其他设备、浏览器或系统的兼容承诺。
