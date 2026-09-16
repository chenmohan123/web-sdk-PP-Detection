# Tiny FP16 双 Hub 首页模型卡更正（2026-09-16）

ModelScope 和 Hugging Face 的 Tiny FP16 权重、0.1.1 清单和 Demo 已发布，但首页总表仍把 Tiny 标为 0.1.0、仅 FP32。原因是原发布器在已有根模型卡后追加 FP16 说明时，没有同步更新已有表格行；FP32 历史段落也仍使用“当前 38 个稳定变体”的措辞。

本次更正双 Hub 的根 `README.md`：Tiny 当前清单改为 `ppyolo-tiny-320/0.1.1/manifest.json`，精度改为 FP32、FP16，首页明确 14 个规格、39 个稳定变体；38 个变体注明为历史批次，并补充 FP16 体积与固定质量证据。W8A32 仍保留 labs。

原发布器、模型卡快照和摘要收据保留原样，本目录记录独立的文档更正。SDK/npm 仍为 0.4.0。

## 已执行验证

- 首页 14 行逐项对照本地稳定 manifest 的版本和精度，共 39 个稳定变体；双 Hub 对应的 28 份 manifest 完整 GET 后与本地内容一致，见 [validation.json](validation.json)。
- 每个 Hub 仅上传根 `README.md`，上传前核对远端父提交及原首页摘要；上传后完整 GET 与[修订模型卡](hub-README.md)逐字节一致，远端文件列表不变，见 [before.json](before.json) 和 [uploads.json](uploads.json)。
- Chromium 153 实际打开两个公开首页，读取渲染后的 Tiny 表格行，均为 `0.1.1 / FP32、FP16`，见 [browser.json](browser.json)、[ModelScope 表格](modelscope-table.png)与[Hugging Face 表格](huggingface-table.png)。

## 固定远端提交

| 来源         | 修正前                                     | 修正后                                     |
| ------------ | ------------------------------------------ | ------------------------------------------ |
| ModelScope   | `6b4e6e46e0515e77735ff2b98b01dac9b447a73b` | `465c09f7e8cb5a78a2c84bf98ee7d4f937aceb0b` |
| Hugging Face | `3e508a8b66e7bd1ef865404623d9bdc49f0040a9` | `1b9db4f7af5af4ebb7d68fb553ee9f6bf019afbf` |

后续根模型卡验收应同时覆盖总表、当前数量和历史段落；文件上传及摘要一致，只能证明传输了预期文件，不能替代文案与稳定清单的一致性检查。
