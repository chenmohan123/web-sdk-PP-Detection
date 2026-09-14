# PP-YOLOE+ M/L/X FP16、W8A32 发布记录

日期：2026-09-14。本轮发布六个新增压缩变体，M/L/X 的当前模型清单升级为 0.1.1。PicoDet 1.0.2、PP-YOLOE+ S 0.1.1 和 M/L/X 0.1.1 各提供 FP32、FP16、W8A32，共 15 个稳定变体。SDK runtime/API 与 npm 保持 0.4.0；Demo 默认 PicoDet、FP32、ModelScope，只提供 ModelScope 和 Hugging Face。

## 质量与体积

[三轮质量报告](../../evaluation/2026-09-14-ppyoloe-mlx-release/README.md)记录全部 54 组浏览器运行：固定 64 图、716 标注，每个候选与同轮、同规格、同后端 FP32 比较。发布门槛为 AP 下降≤0.5 个百分点，score≥0.5、同类 IoU≥0.5 一对一匹配保留≥95% FP32 检测；IoU≥0.99 仅诊断坐标偏差。旧单轮报告及其严格坐标门槛下的 labs 结论保持原样。

| 规格 | FP32 字节数 | FP16 字节数 | W8A32 字节数 |
| --- | ---: | ---: | ---: |
| M | 94,022,904 | 47,104,975 | 23,818,631 |
| L | 209,181,400 | 104,700,181 | 52,698,311 |
| X | 394,163,636 | 197,207,187 | 99,048,805 |

FP16 文件约缩小 50%，W8A32 约缩小 75%。FP16 保留敏感算子 FP32；W8A32 的权重 INT8 存储，激活和卷积计算为 FP32，SDK 精度参数为 `int8`。体积收益独立计入发布判断，不推导普遍加速或内存同比下降。需要尽量贴近原始框坐标时可选 FP32。

## 固定来源与许可

三规格均沿用 PP-YOLOE+ S 的上游 Apache-2.0 发布口径，来自 PaddleDetection 固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 的官方配置及 COCO 权重。各版本保留上游 LICENSE、官方权重 SHA-256、转换修改及精度边界。固定上游没有发现按规格不同的许可或独立权重许可文件。Hub 是本项目维护的转换镜像，COCO 测试图片仍遵守各自许可。

新增权重使用两个 Hub 的真实不可变提交。FP32 复用原 0.1.0 固定来源及相同字节；只更新当前清单，不覆盖原发布资产。

| 规格 | 来源 | 新权重提交 |
| --- | --- | --- |
| M | modelscope | `d3b287e01fce0d7baffad3be25c67f25e2fb2266` |
| M | huggingface | `8f64a8d67289419649f3396f475963ca003d48d9` |
| L | modelscope | `8e4edd52ef112ebc338e3a1907508ecc0c826fb4` |
| L | huggingface | `7604cde4edd68705a62ec2378b60f9c76264d2d9` |
| X | modelscope | `46cf1e3c9f847cd3108068b9d604b890fea3f79e` |
| X | huggingface | `de9e49e6d61447384c0bfec980499f5901de014d` |

[downloads.json](downloads.json)完整回读 12 个权重来源并核验字节数及 SHA-256；[metadata-downloads.json](metadata-downloads.json)回读 18 份 manifest/模型卡/LICENSE；[catalog-downloads.json](catalog-downloads.json)回读两个 Hub 总目录，全部通过。上传记录分别见 `weights-uploads.json`、`metadata-uploads.json` 和 `catalog-uploads.json`。显式来源失败不静默换源，ONNX 不进入本轮 Git 或 npm 产物。

## 生命周期与验证边界

[desktop-smoke.json](desktop-smoke.json)覆盖六变体 × WASM/WebGPU × main/Worker 共 24 组真实模型推理。主线程与 Worker 结果一致；预取消返回 `ABORTED`，恢复检测结果一致；释放后检测返回 `DISPOSED`。关闭缓存、后端回退与小目标增强；单张 `people.jpg` 验证不等于覆盖所有进行中取消竞态。

Windows 11 x64（10.0.26200）、Intel Core i5-10400F、Chromium 153.0.8010.12、ORT Web 1.27.0、SDK 0.4.0；物理 WebGPU 适配器为 nvidia/blackwell。三轮质量记录比较完整 GPU 身份，生命周期观察同一默认适配器。ORT 的 shape 等节点可能由 CPU 执行，不等同于 SDK 后端回退。

本轮只新增上述桌面证据，不扩大手机、微信 WebView、其他浏览器或全量 COCO 兼容声明。X FP32 约 394 MB，压缩后仍有较高加载与 CPU 推理开销；未测内存峰值。

## 复现

- 质量：使用评测 Python 环境执行 `reports/evaluation/2026-09-14-ppyoloe-mlx-release/summarize.py`，从固定 Git 证据和归档离线复算；新增证据检查见同目录 `test_evidence.py`。
- 生命周期：`node reports/distribution/2026-09-14-ppyoloe-mlx-precision/desktop-smoke.mjs`，需要既有 jobs 指定的同 SHA 权重、SDK bundle 和测试图片。
- 分发回读：用宿主 Python 执行本目录 `verify-downloads.py weights`、`metadata`、`catalog`；无需凭据。
- 重新发布：`publish.py` 分阶段保留真实上传提交，必须先有全部质量和生命周期证据；不可覆盖已有版本。
- 本地完整检查与正式 HTTPS Demo 的部署验收记录见 [verification.md](verification.md)。
