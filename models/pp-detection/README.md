# PicoDet 模型资产

本目录根部保留 PicoDet-L-320 1.0.1 FP32 历史资产；当前发布清单位于 [`1.0.2/manifest.json`](1.0.2/manifest.json)，提供 FP32、FP16、W8A32 六变体中的三个 PicoDet 稳定变体。不要覆盖已发布版本目录。
当前新增 XS/S/M 320/416 与 L 416/640 八个规格位于各自 1.0.0 目录，和 L320 三精度一起构成 13 个规格、23 个 stable 变体。权重固定来自 PaddleDetection 提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，来源为 ModelScope 与 Hugging Face。

1.0.2 清单默认 ModelScope，并可显式选择 ModelScope 或 Hugging Face；每个来源都记录不可变 revision、下载地址、大小和 SHA-256。FP16/W8A32 当前证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图验证，小米 15 实测仅覆盖原 FP32。历史报告继续作为对应旧版本证据，不能覆盖当前清单状态。
