# PP-YOLOE 0.1.0 稳定状态记录

2026-09-12，用户在小米 15 测试后明确决定：“可以直接标记为稳定模型。后续遇到问题再修改。”本地 PP-YOLOE+ S 640 FP32 清单及变体据此标记为 **0.1.0 stable**，Demo 显示稳定状态，默认加载无需 `allowExperimental`。PicoDet 仍是 Demo 默认模型。

## 版本与来源

| 项目                  | 状态                                                               |
| --------------------- | ------------------------------------------------------------------ |
| 模型身份              | `ppyoloe-plus-s-640`                                               |
| 旧版本 / 新版本       | `0.1.0-labs.1` / `0.1.0`                                           |
| 清单及 FP32 变体      | `stable`                                                           |
| 模型字节数            | 31,954,220                                                         |
| 模型 SHA-256          | `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c` |
| Hugging Face revision | `45a646ce13dcf2e2c05231954b1e32b9c412720b`                         |
| ModelScope revision   | `af865f1c515634de08fe0fc5eeeac8942456241c`                         |

当前入口为[模型清单](../../../models/ppyoloe-plus-s-640/manifest.json)和[模型卡](../../../models/ppyoloe-plus-s-640/README.md)。ONNX 未重新转换或修改，固定来源仍指向先前分发的字节；源路径中的实验版本目录不影响当前清单状态。清单版本变化会建立新的缓存身份，旧缓存仍可通过“清理全部本 SDK 缓存”移除。

Hub 上已有不可变清单仍是实验版历史快照，本轮稳定清单和 Demo 在本地更新。旧[清单](previous/manifest.json)和[模型卡](previous/README.md)按原始字节保留，便于核对先前上传记录；旧测试报告的状态、版本、截图和哈希不改写。清单摘要与状态裁决见 [promotion.json](promotion.json)。npm、GitHub 与 Pages 未在本轮发布。

## 验证依据

- [64 张 COCO 场景子集](../../evaluation/2026-09-11-ppyoloe/README.md)：转换一致性、WASM/WebGPU 功能和子集质量指标。
- [ModelScope 实际 Demo 验收](../../distribution/2026-09-11-ppyoloe/verification.md)：固定下载、模型校验、两个后端和缓存复用。
- [小米 15 人工实测](../../distribution/2026-09-11-ppyoloe/mobile-xiaomi15-2026-09-12/README.md)：用户确认 CPU/GPU 正常，Android Edge 后置摄像头截图确认实际 WebGPU/FP32/main。

稳定状态是本次用户确认的维护决定。设备与质量证据仍限定于上述实际范围：64 张子集不等于全量 COCO 成绩；小米 15 反馈不扩展为其他手机、浏览器或微信 WebView 的实测。其他设备问题按后续反馈修复。

## 本轮检查

最终[核验结果](verification.json)：SDK 清单、来源、factory 和选择器 43 项通过；Demo 相关测试 22 项通过（首轮 21 项通过，修正旧单来源预期后补跑 1 项通过）；文档契约 5 项通过，Demo 类型检查、lint、构建、266 个文件的格式检查与 `git diff --check` 通过。更新前稳定状态测试先确认失败，改为稳定配置后通过。

[WASM 3 次](wasm/desktop-browser.json)和 [WebGPU 2 次](webgpu/desktop-browser.json)真实检测全部通过：PP-YOLOE 结果版本为 `0.1.0`，实际后端和来源符合选择，无回退、无页面异常；390px 无横向溢出。验收源码/清单哈希与最终文件一致，旧 manifest 和模型卡字节与历史上传记录一致。

手机原局域网入口已更新，页面显示 `PP-YOLOE+ S 640 · 0.1.0 · 稳定`，见[局域网页面截图](lan-stable.png)。这是本机浏览器对局域网 HTTPS 地址的复查，小米原始实测仍对应相同模型字节的 `0.1.0-labs.1` 清单。

治理[复查](standard-after.json)为 `locally-compliant`：required 18 项通过、0 失败、4 项远程规则跳过。

验收脚本 [verify-demo.mjs](verify-demo.mjs)复用此前真实浏览器流程，增加 `0.1.0` 与稳定状态断言；不注入模型数据或检测结果。重建生产 Demo 后执行：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path .tmp/dependencies-compatible-browsers).Path
$env:PPDETECTION_DEMO_URL = "http://127.0.0.1:4176/web-sdk-PP-Detection/"
$env:PPDETECTION_DEMO_BACKENDS = "wasm"
$env:PPDETECTION_REPORT_DIRECTORY = "reports/stability/2026-09-12-ppyoloe/wasm"
node reports/stability/2026-09-12-ppyoloe/verify-demo.mjs
$env:PPDETECTION_DEMO_BACKENDS = "webgpu"
$env:PPDETECTION_REPORT_DIRECTORY = "reports/stability/2026-09-12-ppyoloe/webgpu"
node reports/stability/2026-09-12-ppyoloe/verify-demo.mjs
```
