# Changelog

## 未发布维护改动

- ONNX 权重下载新增可取消的请求总时限、无新增字节时限和有限同源重试；默认 180 秒、30 秒和 2 次重试，失败残片不缓存。
- `createPPDetection` 和 `ModelManager` 接受可选 `download` 配置，下载进度新增 `attempt/maxAttempts`，耗时包含重试与等待。
- 同步两模型六个稳定变体的接入文档，新增使用公开 npm 0.3.1 与固定 Hub 清单的 `examples/model-variants` 示例。
- SDK/npm 版本仍为 0.3.1；上述下载能力尚未发布，模型清单和资产字节保持既有发布状态。

## 模型与 Demo 更新（2026-09-12，SDK 0.3.1）

- 上线 PicoDet 1.0.2 与 PP-YOLOE 0.1.1 的 FP32/FP16/W8A32 稳定模型选择，默认FP32，双源默认ModelScope。
- FP16体积分别减少36.3%/49.8%，W8A32减少73.7%/74.3%；体积与速度独立比较。
- 36组固定COCO子集识别验证通过；两Hub新版本资产及清单固定revision并校验SHA-256。
- SDK API及npm版本继续0.3.1；模型文件与Demo独立更新。新精度的手机兼容性尚未实测。
- [识别和性能对比](reports/evaluation/2026-09-12-precision-variants/README.md)。

## 0.3.1（2026-09-12）

模型、来源、许可和验证边界见[发布说明](docs/zh-CN/release-0.3.1.md)（[English](docs/en/release-0.3.1.md)）。

- 小米 15 Android Edge 实机回归：用户确认两款模型的 CPU/GPU 测试均正常，截图直接确认 PP-YOLOE WebGPU/FP32/main。

- 优化两款模型共用的 bicubic 预处理，保持逐位张量和同后端检测结果一致；本机 PP-YOLOE WebGPU 热端到端中位数降低 25.5%，详见 [2026-09-12 评测](reports/evaluation/2026-09-12-preprocess/README.md)。

- 归档 PP-YOLOE FP16 体积、精度和真实性能评测及 WebGPU 归约溢出的最小复现，候选保持 labs。
- 同步门户与模型说明，六类独立示例升级到公开 SDK 0.3.0。
- npm 发布后等待 registry 最多十分钟，区分暂时和永久错误，并归档成功或失败的等待记录。

## 0.3.0（2026-09-12）

- 修复结果显示后缓存统计尚未完成时，快速切换后端并开始检测会忽略点击的问题；开始按钮等待当前任务完整结束后恢复可用。

模型、来源、许可与验证边界见[发布说明](docs/zh-CN/release-0.3.0.md)（[English](docs/en/release-0.3.0.md)）。

- PP-YOLOE+ S 640 FP32 经桌面验证和小米 15 人工实测后，按用户确认标记为 `0.1.0 stable`；默认加载无需 `allowExperimental`，已验证设备范围随记录保留。
- Demo 增加独立模型选择，默认 PicoDet；来源仅显示 ModelScope 和 Hugging Face，两个模型均默认 ModelScope；随构建携带固定来源清单，切换模型时取消旧任务并隔离缓存身份。
- PP-YOLOE 稳定清单复用 Hugging Face / ModelScope 已分发的相同模型文件；实验版清单、模型卡和评测记录保留为历史快照。当前稳定清单随 v0.3.0 标签归档并用于线上 Demo。
- Demo 将检测列表与导出置顶，详细耗时、模型与缓存按需展开；移除冗余说明，示例只显示图片，选中信息移入固定工具栏，避免画面上下跳动。
- 增加显式 `allowExperimental` 选项，用于本地 `labs` 模型验证；默认关闭，`blocked` 始终拒绝，同精度优先选择稳定变体。
- 新增官方 COCOeval、一对一检测匹配、固定 COCO 子集和 PP-YOLOE+ S FP32 来源/转换/浏览器评测工具，提供本地候选接入指南和带日期的验证报告。

## 0.2.0（2026-09-08）

完整模型、来源、许可与验证边界见[发布说明](docs/zh-CN/release-0.2.0.md)（[English](docs/en/release-0.2.0.md)）。

- 新增 `ModelManager.getCacheEstimate(model?)`、`clearCurrentModelCache(model?)` 的模型身份参数，以及可选的 `ModelCache.scope`、`list()`；缓存容量按键去重，自定义缓存不支持模型枚举时明确报错。

- 修复初始化计时遗漏清单与校验、Worker 版本缺失及后端回退改写历史结果的问题；新增实际模型获取来源与运行环境快照，明确当前 FP32 模型的性能验证边界。
- 修复视频与摄像头连续帧重复初始化、帧调度使用旧配置以及视频切摄像头误停媒体流；Demo 初始化总耗时包含清单获取，图片与连续媒体分别说明会话策略。
- 修复 Worker GPU 推理失败后，CPU 回退重试使用已转移输入缓冲区而再次报错的问题。

- 修复清理期间的迟到缓存写入、共享缓存管理器协调和实际容量统计；Demo 支持当前模型及全部本 SDK 缓存清理，并在清理后撤下旧检测框。
- 六种示例补齐独立安装、真实推理、取消及迟到实例释放，默认使用 ModelScope 模型清单。
- 根 README、npm README 与双语 API 文档明确工厂必须接收 `model` 或 `manifest`；npm 包不包含 ONNX 模型本体，不再宣称省略配置可加载默认模型。
- 修正 Vue、Vite 和微信 WebView 示例的清单路径与 SDK 依赖；补充移动浏览器和微信 WebView 的真实设备验证边界说明。

## 0.1.1

- 修复目标检测 Demo 的类别阈值、摄像头设备选择和官方示例图片展示。
- 修复自动后端选择优先 WebGPU，并在允许回退时正确处理仅支持 WASM 的模型变体。
- Demo 类别阈值改为读取目标检测类别（默认 PicoDet COCO 标签），移除版面分析和 mask 相关文案。
- Demo 摄像头场景支持枚举并选择多个视频输入设备；示例图片改为 PaddleDetection 官方目标检测图片。
- SDK 结果记录实际后端和 WebGPU 回退原因，便于诊断运行时兼容性。
- npm 包与 Demo 版本更新为 0.1.1；模型资产继续复用 PicoDet-L-320 1.0.1 FP32 stable 版本。

## 0.1.0

- 发布 PicoDet-L-320 1.0.1 FP32 stable 模型，默认来源为 Hugging Face，并保留 Git LFS、ModelScope 的不可变来源。
- FP32 已通过 Linux WASM 与 Windows NVIDIA WebGPU 七张 fixture 验证；FP16、INT8、INT4、FP8、移动端和微信 WebView 保持实验或待验证状态。
- Demo 继续覆盖图片、摄像头和视频输入，并展示 CPU/GPU 加载与推理耗时及模型信息。

- 初始发布 PaddleDetection PicoDet-L-320 Web SDK 骨架，采用 Apache-2.0，运行时基于 ONNX Runtime Web。
- 提供 CPU/WASM 与 GPU/WebGPU 手动选择、main/Worker 执行模式、版本化缓存、SHA-256 校验和可取消的资源释放。
- Demo 覆盖图片、摄像头和视频输入，并展示模型信息、模型来源、CPU/GPU 后端、精度、加载耗时和推理耗时。
- 模型清单支持 Git LFS、Hugging Face、ModelScope、custom 来源以及 FP32、FP16、INT8、INT4、FP8 变体声明；当前 PicoDet 真实 ONNX 资产保持 `labs/blocked`，未伪造大小、参数量、revision 或浏览器证据。
- 提供 Vanilla、React、Vite、CDN 和微信 `web-view` 集成文档；不宣称微信原生小程序直接推理。

## 1.1.0

- Added per-class confidence thresholds through `classThresholds`, with fallback to the global `threshold` and then `0.5`; the global threshold continues to control mask binarization and polygon extraction.
- Added a responsive Demo editor for active class thresholds, including blank-value inheritance, clear-all support, and bilingual accessible controls.

## 1.0.6

- Added validated CPU/WASM support for the bundled FP16 model through immutable model manifest `1.0.2`, reusing the published `1.0.1` model binaries.
- Kept WebGPU FP16 and FP32 support while expanding the default CPU/WASM matrix to FP16 and FP32.

## 1.0.5

- Adopted immutable PP-Detection model `1.0.1`, enabling validated strict WebGPU FP32 execution while retaining WebGPU FP16 as the preferred automatic path.
- Versioned model validation evidence and Pages staging so historical `1.0.0` assets remain unchanged.

## 1.0.4

- Corrected the validated default backend matrix to WebGPU FP16 and WASM FP32, made manual Demo selections strict, and exposed detailed runtime fallback causes.

## 1.0.3

- Fixed explicit backend selection so CPU/WASM requests no longer fall back to WebGPU, and reject unsupported explicit CPU/WASM + FP16 combinations.
- Updated the Demo to disable FP16 for CPU, explain automatic FP32 selection, and show fallback history before long detection result lists.
- Separated model download progress from model loading and grouped initialization and per-detection timings for clearer performance reporting.
- Reorganized the Demo into a denser responsive layout with four sample documents below the image result and a direct GitHub repository link.
- Synchronized the backend/precision support matrix and timing guidance across the SDK README and bilingual repository documentation.
- Updated the development esbuild resolution to 0.28.2 and added a regression check for GHSA-g7r4-m6w7-qqqr.

## 1.0.2

- Added separate model download, cache read, integrity verification, and Session creation timings through `detector.loadTimings`.
- Added `modelSource` metadata for network, persistent cache, memory cache, and custom in-memory models.
- Added official PaddleOCR sample documents to the Demo and fixed sample loading under the GitHub Pages base path.
- Published the SDK with bilingual README documentation for the detailed load timing fields.

## 1.0.1

- Added Chinese-first bilingual npm package documentation.
- Migrated npm releases to GitHub Actions Trusted Publishing with provenance and no npm token.
- Served validated FP16 and FP32 model assets from GitHub Pages so browsers can load the built-in model without CORS failures.

## 1.0.0 (release candidate)

- Added browser-first PP-Detection SDK runtime with WASM/WebGPU backend selection.
- Added FP32 and FP16 model contracts, custom manifests, caching, workers, bilingual docs, demos, and consumer examples.
- Added release workflows, model validation reports, and an auditable real-model benchmark workflow.
- Passed the 1.0.0 runtime benchmark gate for FP32/WASM, FP16/WebGPU on NVIDIA hardware, and responsive screenshots. Publishing model assets, npm, tags, and Pages remains a separate authorized release step.
