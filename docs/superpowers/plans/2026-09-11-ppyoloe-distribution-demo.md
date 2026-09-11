# PP-YOLOE 分发与 Demo 实施计划

> 执行代理：使用 superpowers:subagent-driven-development 实施并审查任务，连续推进已获授权的工作。

**目标：** 固定分发已验证候选，在 Demo 中安全选择，并交付可复核的桌面与移动验证状态。

**架构：** 独立 DetectionManifest 描述实验模型；Demo 随包读取固定清单，模型选择与来源选择分离；历史评测证据保持可复核。

**技术栈：** TypeScript、React、Vite、Playwright、Python Hub 客户端。

**设计依据：** `docs/superpowers/specs/2026-09-11-ppyoloe-distribution-demo-design.md`。

## 全局约束

- 保留现有未提交评测成果，沿用 `codex/ppyoloe-evaluation-baseline` 分支。
- 中文文档、回复、注释和提交信息；UI 保留原有语言切换。
- 模型保持 labs；不将不同模型混成精度 variants；不修改门户标准。
- 不进行 npm 发布、GitHub 合并、推送或 Pages 部署。模型 Hub 独立目录上传已获用户确认。
- 实机缺失如实记录，不把视口模拟当作设备验证。

## 任务 1：固定模型分发

文件：新增 `models/ppyoloe-plus-s-640/manifest.json`、同目录模型卡；新增 `reports/distribution/2026-09-11-ppyoloe/`；必要脚本放 `tools/model-pipeline/ppyoloe/`。

接口：任务 2 消费上述 manifest；id=`ppyoloe-plus-s-640`、version=`0.1.0-labs.1`、status=`labs`，来源仅包含实际已验证的仓库提交。

- [x] 校验候选 bytes/SHA256，生成独立上传清单、许可与模型卡。
- [x] 使用现有登录上传至已存在模型仓库的独立版本目录；保存模型提交 revision。
- [x] 回下载固定 URL，匹配 SHA256/bytes 后生成本地与远端 manifest，记录 manifest 提交 revision。
- [x] 审查来源与复现记录；未可用镜像明确记录。

## 任务 2：Demo 模型选择

文件：`apps/demo/src/model-sources.ts`、`App.tsx`、`i18n/*`，必要的选择配置模块及 `apps/demo/tests/model-selection.spec.ts`。

接口：使用任务 1 的 DetectionManifest；稳定模型仍为 `models/pp-detection/manifest.json`。工厂调用显式传 `allowExperimental`，缓存身份使用所选 manifest.model。

- [x] 添加行为测试：默认 PicoDet，切换 PP-YOLOE 后旧结果消失、创建实验 detector、清理当前缓存只作用于当前模型。
- [x] 实现模型选项及来源可用性，使用固定本地清单，不再从浮动分支读取官方 manifest。
- [x] 复用取消、停止媒体、释放 detector 的现有流程，阻止迟到结果写入新模型状态。
- [x] 验证来源失败、切换竞态、390px 布局及既有 Demo 交互；运行 Demo 类型检查和构建。

## 任务 3：分发与浏览器交付验证

文件：`reports/distribution/2026-09-11-ppyoloe/README.md`、浏览器结果与移动验证清单；更新 README、CHANGELOG 和候选示例入口。

- [x] 真正运行桌面浏览器候选推理与模型切换，检查实际后端、运行状态和无横向溢出。
- [x] 检测可用实体设备；有设备则记录实机结果，没有则记录待验证并提供直接操作步骤。
- [x] 执行 SDK/Demo 测试、相关文档测试、类型检查、构建和变更后治理检查。
- [x] 审查整体验证与实现，修复具体问题，更新计划和交付说明。
