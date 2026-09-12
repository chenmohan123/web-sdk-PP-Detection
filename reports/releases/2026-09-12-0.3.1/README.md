# 0.3.1 发布验收

日期：2026-09-12。发布说明见[中文版](../../../docs/zh-CN/release-0.3.1.md)和[对应文档](../../../docs/en/release-0.3.1.md)。

- [小米 15 实机回归](mobile-xiaomi15.md)：测试构建为 1c33a7a，用户确认两款模型 CPU/GPU 正常。
- [预处理性能与数值一致性](../../evaluation/2026-09-12-preprocess/README.md)：保留独立基线、逐图输出与哈希。
- [线上验收脚本](verify-live.mjs)：版本、ModelScope 默认来源、两模型 CPU/GPU 真实检测、导出及 1440/390 布局。通过 PPDETECTION_RELEASE_URL 和 PPDETECTION_RELEASE_REPORT 可指定本地预发布 URL 与输出位置。

## 发布检查清单

按门户 standards/v1/templates/release-checklist.md 执行。验证范围包括版本一致性、完整本地校验、真实浏览器、SDK 规范检查、PR 当前 CI、保护规则、npm 发布及 provenance、GitHub Release、HTTPS Demo 和门户部署。

发布前后产生的原始记录通过 GitHub Release 的验收附件保存；正文按实际结果填写，不把本地构建等同于线上已发布。
