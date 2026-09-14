# PP-YOLOE+ M/L/X 正式 Demo 验证

日期：2026-09-14。正式地址：<https://chenmohan123.github.io/web-sdk-PP-Detection/>。

本记录绑定 SDK 仓库 GitHub Pages 工作流 `34840438741`，部署提交为 `26333e2c77adf424b75a056e387f91f13c2d65d9`。脚本从 SDK 仓库 Actions API 读取该身份，并将线上 M/L/X `0.1.1` manifest 与提交中的文件逐字节核对。

ModelScope 来源下，M/L/X 的 FP16 与 W8A32 在 CPU 和 GPU 各完成一次完整页面生命周期验证，共 12 组。每组均确认页面加载、版本与精度、实际后端、固定来源 revision/SHA-256、person 检测结果和无页面错误；记录见 [production-verification.json](production-verification.json)。

这份线上记录是桌面 Chromium 153、Windows 11、ORT Web 1.27.0 的发布 smoke，不能扩大为移动端、其他浏览器、微信 WebView、峰值内存或完整 COCO 兼容结论。质量、生命周期和双源下载回读分别见 [质量报告](../../evaluation/2026-09-14-ppyoloe-mlx-release/README.md)、[桌面生命周期记录](desktop-smoke.json) 和 [分发回读](downloads.json)。

本次收尾的完整 Demo 回归为 82/82 通过，转换及质量证据 Python 测试 35/35、浏览器评测 runner 测试 5/5、双语文档检查 5/5、发布契约测试 29/29 通过。Demo 在相同仓库测试集上使用临时 Playwright 配置，只将 Vite 配置加载改为 `--configLoader runner` 并将测试输出放入新临时目录，以避开旧缓存 ACL；82 项断言没有跳过或修改。测试完成后手动终止本轮 Vite 进程以结束 Windows teardown，Playwright 退出码为 0。

发布契约测试使用含当前修改的干净 Git 源码快照；受限沙箱中的旧目录写入和 esbuild 上级目录读取曾失败，使用宿主权限后 29 项全部通过。完整 SDK CI 另由受保护 PR 的 `validate` 与 `browser` 检查执行，不以局部测试代称本地完整 `pnpm verify`。
