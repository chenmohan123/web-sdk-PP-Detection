# Changelog

## Unreleased

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
