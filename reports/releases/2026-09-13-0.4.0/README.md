# 0.4.0 发布验收（2026-09-13）

发布候选基于正式版本 `152b176`，功能与小米 15 反馈提交为 `781c002`。版本新增小目标增强可选 API，按次版本发布；实验能力默认关闭。

## 发布前清单

- [x] 中文默认入口、英文对应说明、npm 元数据及 Demo 链接已同步 0.4.0。
- [x] Changelog 与双语发布说明记录功能、模型来源、许可及验证限制。
- [x] 模型沿用 PicoDet 1.0.2 / PP-YOLOE 0.1.1 的固定 revision 和 SHA-256。
- [x] 2026-09-13 读取 GitHub API：main 规则 21779070 要求 PR、最新提交两项 CI、解决讨论，禁止删除及强推，无 bypass；标签规则 21779094 禁止更新和删除 v*，无 bypass。
- [x] Pages 使用 workflow、强制 HTTPS、github-pages 环境；仓库 About、Homepage、topics 已配置。
- [x] 当前候选的发布脚本、Demo、浏览器、API 和 SDK 规范检查通过。发布脚本包含 204 项 SDK 单测、29 项发布/安全契约测试和 4 项打包消费浏览器测试；Demo 全量回归首跑有 2 个初始化时序超时，随后清理缓存和缩放边界用例各自复跑通过。
- [ ] PR 合并，最新提交通过必需 CI。
- [ ] 不可变 v0.4.0 标签、npm Trusted Publishing 与 GitHub Release 完成。
- [ ] 线上 Demo、npm 版本及包完整性验收通过。

远程记录将在发布阶段补齐 commit、PR、运行和部署链接。前期 24 组真实模型验证、204 项单测及用户反馈边界见[功能验收](../../verification/2026-09-13-small-objects/README.md)，不能据此宣称所有手机组合均已通过。

本地复核时间：2026-09-13 14:06–14:12（Asia/Shanghai）。远程 Ruleset、Pages 设置及 Pages 分支策略的只读快照保存在本目录；快照不含凭证。
