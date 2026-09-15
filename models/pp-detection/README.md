# PicoDet 模型资产

2026-09-15：当前 SDK 共 13 个规格、37 个稳定变体。PicoDet 新增 14 个达标 FP16/W8A32 精度，版本 1.0.1；L-320 保持 1.0.2。

PicoDet 共九个输入规格；SDK 另提供 PP-YOLOE+ S/M/L/X。L-320 当前清单为 `1.0.2/manifest.json`，本轮新增规格清单为 `picodet-<size>-<res>/1.0.1/manifest.json`。原 1.0.0 FP32 及历史版本保持不可变。

默认 FP32、ModelScope，可显式选择 Hugging Face。所有来源固定 revision、bytes 与 SHA-256。PicoDet 新精度仅有桌面三轮和主线程/Worker证据，手机证据不扩展。

[完整精度表](../../docs/zh-CN/models.md) · [本轮对比与发布证据](../../reports/evaluation/2026-09-15-picodet-series-precision/README.md)
