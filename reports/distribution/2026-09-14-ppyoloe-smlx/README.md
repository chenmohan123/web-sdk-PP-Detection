# PP-YOLOE+ S/M/L/X FP32 发布记录

日期：2026-09-14。此轮新增 M/L/X 640 的 0.1.0 稳定清单及 Demo 选择项，S 沿用 0.1.1 的 FP32/FP16/W8A32。SDK runtime/API 和 npm 版本保持 0.4.0。Demo 默认 PicoDet、ModelScope、FP32；五个模型均只提供 ModelScope 和 Hugging Face，并默认 ModelScope。

## 模型与质量

| 规格 | FP32 字节数 | Python OpenCV AP | Paddle→ONNX 匹配框数 |
| ---- | ----------: | ---------------: | -------------------: |
| S    |  31,954,220 |    见既有 S 评测 |         复用既有证据 |
| M    |  94,022,904 |           48.85% |            502 / 502 |
| L    | 209,181,400 |           51.37% |            533 / 533 |
| X    | 394,163,636 |           53.05% |            569 / 569 |

固定 COCO val2017 场景子集共 64 图、716 条标注，使用官方 COCOeval bbox；这不是完整 COCO mAP。逐框核验门槛为 score≥0.5、IoU≥0.99；三规格均无未匹配框，最大坐标分量差分别为 M 0.000244、L 0.000184、X 0.000184 像素。图内 NMS 阈值 0.01、IoU 0.7，最终最多 300 框；SDK 质量评测阈值 0.001、二次 NMS IoU 1。

M/X 的 Python 官方参考使用 OpenCV，浏览器使用原 JPEG 与 SDK bicubic。分别核验 Paddle→ONNX 与 WASM→WebGPU，不把不同预处理的结果混为同一逐框参考。M/X 的浏览器两个后端均完成 64 图；L 复用同一 SHA-256 的既有 WebGPU64图、WASM8图评测，输入为像素相等的 PNG。详见 [summary.json](summary.json) 与 [L 对照评测](../../evaluation/2026-09-13-sod-comparison/README.md)。

## 来源与许可

S/M/L/X 均来自 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 的 `configs/ppyoloe/ppyoloe_plus_crn_{s,m,l,x}_80e_coco.yml` 和官方 COCO 权重。沿用已发布 S 的 Apache-2.0 发布口径，逐版本保留上游 LICENSE、官方权重 SHA-256 和转换修改说明；未发现按规格不同的许可或独立权重许可文件。Hub 是本项目自行维护的转换镜像，不是上游官方账号；COCO 图片仍遵守各自许可。

新增权重固定 ModelScope revision `3939f806feff4cce7118913a1dfe2e348d4c7204`；Hugging Face 分别固定 M `e9b6ac0c0444dd8104992fe42f7869463870feff`、L `5f203ba3bb8bc8943ac8c69fa5524ded356e8bc6`、X `4f92a4267c994a49a09ab30b951b26da76b20dab`。模型卡与双源清单归档在 ModelScope `e1fcf068e1051a502d0790ccd93c7a17c16d9be9`、Hugging Face `69f919094eb041cf7853c08cd63cb6ed38a9ace5`。

[downloads.json](downloads.json) 记录六个固定权重 URL 的完整回读、字节数和 SHA-256 核验，全部通过。显式来源失败不会静默换源。模型权重只在 Hub 按需分发，不新增 ONNX 到 npm 或 SDK 源码仓库。

## 桌面兼容与限制

Windows 11 x64（10.0.26200）、Intel Core i5-10400F、Chromium 153.0.8010.12、ORT Web 1.27.0、SDK 0.4.0；WebGPU 物理适配器 `nvidia / blackwell`。不推测浏览器隐藏的具体显卡型号。

[desktop-smoke.json](desktop-smoke.json) 覆盖 S/M/L/X × WASM/WebGPU × main/worker 共 16 组真实模型推理。同一后端主线程与 Worker 的结果完全一致；预取消返回 `ABORTED`，随后检测恢复正常；释放后返回 `DISPOSED`。全部关闭回退、缓存和小目标增强。使用 `people.jpg` 单图验证生命周期，不把这些计时作为性能排名，也不声称覆盖进行中的所有取消竞态。

新增 M/L/X 仅 FP32；L 的 FP16/W8A32 仍保留原 labs 结论。没有新增手机或微信 WebView 实测，不把历史小米 15 的 S/PicoDet 结论扩展到大规格。X 下载约 394 MB，CPU 推理达到秒级；没有测量内存峰值，文件大小不代表内存需求。

## 复现与证据

- 转换：锁定环境见 `tools/model-pipeline/ppyoloe/requirements.lock`，使用 `export.py --variant m|l|x` 与 `fix_onnx.py`；固定配置、官方权重及修正前后 SHA-256 随模型卡和压缩证据记录。
- 质量：`python reports/distribution/2026-09-14-ppyoloe-smlx/summarize.py` 从压缩证据离线重算 COCO、逐框匹配与摘要；首次归档使用 `--archive`。[evidence-index.json](evidence-index.json) 固定原始及 gzip 摘要。
- 下载：`python reports/distribution/2026-09-14-ppyoloe-smlx/verify-downloads.py` 完整回读六个权重。
- 生命周期：`node reports/distribution/2026-09-14-ppyoloe-smlx/desktop-smoke.mjs` 使用本地重建的模型；脚本开头列出路径，模型内容必须与清单 SHA-256 相同。
- 标准检查使用源码快照避开历史临时目录 ACL，不修改目录权限。最终本地与线上结果见 [verification.md](verification.md)。
