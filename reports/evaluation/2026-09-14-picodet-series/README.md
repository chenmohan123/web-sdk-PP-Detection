# PicoDet 常规系列 FP32 评测

日期：2026-09-15。范围为 PaddleDetection `release/2.9`（revision `b25522a0f4bde8c80603f3ba5e3472059972e3b5`）的 PicoDet LCNet 常规系列，共 9 个输入规格：XS/S/M 的 320、416，以及 L 的 320、416、640。

本轮候选图先执行官方后处理图清理，再执行 PicoDet WebGPU 兼容清理。最终同一份 FP32 ONNX 同时用于 WASM 和 WebGPU，避免仅在 WASM 可用而 WebGPU 推理失败。所有规格均通过 ONNX checker、64 张固定 COCO 图片的逐图官方输出对齐、WASM 64 图浏览器评测和 WebGPU 64 图浏览器评测。WebGPU 评测环境为 Windows 11、Chromium 153、物理 NVIDIA Blackwell 适配器；WASM 为单线程 main 模式。

逐图对齐要求类别序列相同、分数最大差不超过 `1e-3`，并检查置信度不低于 `0.5` 的框坐标最大差不超过 `0.5` 像素。全量最大坐标误差仍保留在各 JSON 中；低置信度框的坐标不作为用户可见识别回归判定。

| 规格       | 输入 | WASM       | WebGPU     | 逐图对齐   |
| ---------- | ---: | ---------- | ---------- | ---------- |
| PicoDet-XS |  320 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-XS |  416 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-S  |  320 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-S  |  416 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-M  |  320 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-M  |  416 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-L  |  320 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-L  |  416 | 64/64 通过 | 64/64 通过 | 64/64 通过 |
| PicoDet-L  |  640 | 64/64 通过 | 64/64 通过 | 64/64 通过 |

证据文件按规格命名为 `<规格>-wasm.json.gz`、`<规格>-webgpu.json.gz` 和 `<规格>-parity.json`；`jobs.json` 记录最终候选图路径、字节数和 SHA-256。浏览器报告保留实际适配器、运行模式、每图计数和计时信息。移动端、其他浏览器和 NPU 不属于本轮证据；8 个新增规格的 ModelScope 与 Hugging Face 固定 revision、URL 状态和哈希见 `distribution-evidence.json`。

8 个新增规格清单已写入 ModelScope revision `39739aafe769e1fc2843bc9f7bd3b6c3512e217a` 与 Hugging Face revision `aeebbf3b839ee187a20f8e2388e85ee0bc6aa8d3`，状态为 `stable`、版本 `1.0.0`，默认来源为 ModelScope。L-320 沿用 `1.0.2` 清单；全系列共 9 个 FP32 规格。

## 最终发布门槛

`quality.json` 复算同规格官方参考、Python 候选和两个浏览器后端的 AP 与一对一识别保留率。门槛沿用计划：AP 下降不超过 0.5 个百分点；score≥0.5、同类 IoU≥0.5 的保留率至少 95%。九规格全部通过。Python 官方/候选使用同一 Pillow 预处理；浏览器使用原 JPEG 与 SDK bicubic，解码路径的微小差异单独保留。不是完整 COCO mAP。

| 规格           | 官方参考 AP | 浏览器 WASM AP | AP 变化（百分点） | 检测保留率 |
| -------------- | ----------: | -------------: | ----------------: | ---------: |
| picodet-xs-320 |      23.927 |         23.811 |            -0.116 |    100.00% |
| picodet-xs-416 |      27.780 |         27.680 |            -0.100 |    100.00% |
| picodet-s-320  |      28.872 |         29.015 |            +0.143 |    100.00% |
| picodet-s-416  |      33.153 |         33.158 |            +0.004 |     99.21% |
| picodet-m-320  |      33.765 |         33.390 |            -0.375 |    100.00% |
| picodet-m-416  |      37.362 |         37.224 |            -0.137 |     99.71% |
| picodet-l-416  |      37.464 |         37.488 |            +0.024 |     99.41% |
| picodet-l-640  |      39.565 |         39.510 |            -0.054 |     99.76% |
| picodet-l-320  |      34.317 |         34.215 |            -0.101 |    100.00% |

WebGPU 在本轮固定子集的 AP 和匹配计数与对应 WASM 一致，逐项值见 `quality.json`。`desktop-smoke.json` 覆盖 9×2 后端×2 执行模式共 36 组，验证加载、推理、预取消、恢复和释放后拒绝调用。`remote-smoke.json` 覆盖最终清单的九规格双 Hub 共 18 次真实浏览器下载与 WASM 推理，包含 CORS、SHA-256、来源身份和释放；另有 8 个新增规格共 16 个远程文件的完整回读哈希 `downloads.json`。

## 复现与证据保存

`artifact-index.json` 固定浏览器原始报告 gzip 及解压后 SHA-256；不改写原始评测时间、候选阶段清单 SHA 或失败诊断。最终稳定清单的 SHA 由两份 smoke 记录绑定，同一 ONNX 文件哈希与评测候选一致。`quality.py` 的压缩 Python 检测输出用于复算；重新运行需传入 `--image-root` 指向固定图集。执行浏览器脚本前将 `PLAYWRIGHT_BROWSERS_PATH` 指向已安装的 Chromium 153。

## 元数据与发布核对

八个新增规格的清单、模型卡和 Apache-2.0 许可已上传两边 Hub，48 个文件完整回读的字节数和 SHA-256 均一致，见 `metadata-uploads.json`、`metadata-downloads.json`。最终元数据 revision 为 ModelScope `0dd1fcdd9cb1e156e124961c4d0506e5a8b43379`、Hugging Face `26187d907633a031e530663599bb42c247ce117e`；清单里的权重 revision 保持上文的固定值。首次上传的 CRLF/LF 差异保留在 `metadata-initial.json`，后续统一 LF 并重新验证。

2026-09-15 的本地验证：SDK 206 项、PicoDet Python 36 项、文档与发布契约 34 项、Demo Playwright 30 项通过；类型检查、ESLint、格式检查、SDK 与生产 Demo 构建通过。Playwright 在 Windows 下退出 Vite 子进程时卡住，结束已核对归属的测试服务后正常返回退出码 0。标准检查前后均无 required 失败，证据为 `standard-before-final.json`、`standard-after.json`。

复核已归档证据可运行 `python reports/evaluation/2026-09-14-picodet-series/verify_evidence.py`。本机 pnpm 的共享依赖安装检查和 Vite 默认配置缓存存在目录权限限制，验证使用已安装的相同工具版本：pnpm 增加 `--config.verify-deps-before-run=false --config.manage-package-manager-versions=false`，Vite 使用 `--configLoader runner` 与工作区内临时缓存。没有修改依赖锁定或降低测试要求。

本次按门户 `standards/v1/templates/release-checklist.md` 核对模型与 Demo 发布；SDK runtime/API 未改变，npm 保持 0.4.0，不创建新 SDK 版本标签。合并后的 Pages 提交、正式清单逐字节核对及九规格 CPU/GPU 推理由 `production-demo.mjs` 验证，结果写入 `.tmp/picodet-series-production/`，最终部署记录追加到发布 PR。
