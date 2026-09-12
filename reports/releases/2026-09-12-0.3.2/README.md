# 0.3.2 发布验收

日期：2026-09-12。按门户 standards/v1/templates/release-checklist.md 核对本地检查、PR 当前 CI、仓库保护规则、npm provenance、GitHub Release、Demo 与门户部署。

发布说明见[中文入口](../../../docs/zh-CN/release-0.3.2.md)及[对应文档](../../../docs/en/release-0.3.2.md)。实现阶段的[维护验证记录](https://github.com/chenmohan123/chenmohan123.github.io/blob/ec0b530/reports/sdk-standard/2026-09-12-detection-download/README.md)保持原始未发布身份。

[线上验证脚本](verify-live.mjs)检查正式 SDK 版本、两模型默认 ModelScope、FP32 的真实 WASM/WebGPU 检测、导出和桌面/窄屏布局。通过 PPDETECTION_RELEASE_URL、PPDETECTION_RELEASE_REPORT 指定页面与输出目录。

本轮发布原始记录作为 GitHub Release 附件保存；附件按实际结果记录 npm 安装、超时/重试/取消、线上推理及部署提交，不把本地构建写成已上线。
