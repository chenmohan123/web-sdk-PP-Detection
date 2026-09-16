# Tiny 0.1.1 分发记录

日期：2026-09-16。模型：`ppyolo-tiny-320`。本轮只发布质量门禁通过的 FP16，保留原 0.1.0 FP32；W8A32 未上传、未进入稳定清单、未开放 Demo。

## 稳定资产

| 变体               |      字节 | SHA-256                                                            | ModelScope 权重 revision                   | Hugging Face 权重 revision                 |
| ------------------ | --------: | ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| FP32（复用 0.1.0） | 4,511,117 | `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653` | `9ca30805615e4e00e5a643aa89b5aaaaedfa2ad2` | `0a9a95db338aa4e99264205c4f703fbd949af999` |
| FP16（0.1.1）      | 2,357,376 | `331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc` | `f8641fe3a12e62c93af8e8b3397abfb1b78746f7` | `b00cf78779aeb8a9ebcdaba72f23b5e72639c1c9` |

FP16 相对 FP32 缩小约 47.743%，质量摘要最差 AP 变化 -0.174649 点，最低保留率 0.995192，达到本轮门槛。稳定清单 `manifest.json` SHA-256 为 `30e016974c0d725eca14d2a4eb9080e843444cc46fbff5d38be336a8efdb25ec`；稳定口径为 14 个规格、39 个变体，默认仍为 PicoDet-L-320 / FP32 / ModelScope，SDK/npm 仍为 0.4.0。

## 上传与回读

上传顺序为权重、元数据，均通过本轮发布器的明确参数和准备收据校验。权重及元数据在两 Hub 均完成 GET 回读、字节数和 SHA-256 校验；元数据首次 ModelScope 回读发现服务端将 CRLF 规范为 LF，已保留失败证据并使用独立恢复工具统一双源 LF 后重新上传和回读。最终元数据 revisions 为 ModelScope `6b4e6e46e0515e77735ff2b98b01dac9b447a73b`、Hugging Face `3e508a8b66e7bd1ef865404623d9bdc49f0040a9`。

原始证据包括 `weights-uploads.json`、`weights-downloads.json`、`metadata-uploads.json`、`metadata-downloads.json`、`metadata-first-readback-failure.json`、`prepare-receipt.json`、`publish.py`、`repair_metadata.py` 及其测试。没有调用旧 FP32 上传入口。

## 生命周期与浏览器

FP16 已完成 ModelScope/Hugging Face × WASM/WebGPU × main/Worker 的 8 组合真实分发验证：每组真实下载、SHA-256、缓存命中、两种缓存清理、预取消、恢复、释放和重复释放均通过，12 个目标检测结果一致，无静默回退。原始矩阵为 `browser.json`，生命周期证据为 `lifecycle-candidates.json`。

本地 Demo 冒烟另覆盖双源 × WASM/WebGPU 四组合，确认导出结果为 0.1.1/FP16、无回退、检测到 person，桌面截图和 390px 无横向溢出证据位于 `demo-local/`。

## 质量边界

W8A32 SHA-256 为 `9317cbfaf2f36b22430f1cf12c3bd00289458c3878aa3a9d1b34131264b99b53`，最差 AP 变化 -0.537364 点、最低保留率 0.966346，明确拒绝发布，仅保留 Task 1 labs 评测证据。固定 64 图结果不能外推全量 COCO、手机、NPU 或其他浏览器。
