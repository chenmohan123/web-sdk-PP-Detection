# 小目标增强接入验证（2026-09-13）

本次是未发布的 SDK / Demo 增量，开发基线为 `875d24e`，正式发布版本仍为 0.3.2。
新增默认关闭的 `detect(image, { smallObjectEnhancement: true })`，Demo 仅在图片模式提供「小目标增强（实验）」勾选项。

## 实现边界

- 一次解码、同一模型会话、整图及最多四片串行推理；退化整图片段省略，不保留多片 RGBA 缓冲区。
- 复用第二轮 confident-anchor 合并，最终才应用全局/类别阈值；最大 16,777,216 像素，超过时拒绝，不静默缩图。
- 每次 detect 的进度为 0 到 total（1–5），信号取消丢弃整次结果，dispose 停止后续切片并释放会话。
- main / worker 均支持，worker 继续只承载推理；解码、裁切和合并在调用线程。结果中的原图坐标、polygon、index 与 JSON 导出保持一致。
- `preprocessMs` 包含裁切，`postprocessMs` 包含投影和合并；`totalMs` 包含主动让出主线程的等待。模型下载和会话初始化仍单列。

## 真实模型证据

[real-models.json](real-models.json) 记录当前 bundle / worker SHA-256、浏览器和实际运行时、模型 SHA-256、逐次进度、逐框比较及时间。

在 Windows、Chromium 153.0.8010.12、ORT 1.27.0 环境，PicoDet / PP-YOLOE × FP32 / FP16 / W8A32 × WASM / WebGPU × main / worker，共 24 组。
使用独立集首张 1360×765 图片，产品增强流程与同会话执行的冻结实验流程在类别、分数、框坐标和顺序上逐框一致；没有后端回退。
WebGPU 检查了物理 NVIDIA Blackwell 适配器标识。

此外，复核既有第二轮的 8 份原始输出，共 256 图次，产品投影和合并与原始 refined 输出完全一致。
这些验证用于检查代码迁移正确性，不是新一轮 AP 评估，也不能证明移动端效果。
单次时间处于开发机并发验证环境，未经过独占资源和预热轮次控制，不作为性能对比结论。

复现（输入 JSON 引用的本地模型和图片需存在）：

```powershell
pnpm build
node scripts/verify-small-objects.mjs <第二轮实验的inputs.json> reports/verification/2026-09-13-small-objects
```

## 自动化检查

SDK 单元测试覆盖会话复用、默认整图、强弱框阈值、几何投影、极小图、像素上限、取消及释放。
浏览器测试覆盖真实 WASM 的 main / worker 生命周期，以及 Demo 开关、JSON 导出、媒体模式隔离、语言切换和 390px 布局。
文档、示例、发布契约、基准契约、lint、类型和构建记录见 [checks.json](checks.json)。

最终结果：SDK 204 项单测通过；Demo 79 项回归均通过（完整运行 78 项通过，1 项页面就绪超时后单独复核通过）；12 项独立示例测试通过；打包消费与基准浏览器测试共 18 项通过；真实 WASM 的 main / worker 增强生命周期 2 项通过。
详细浏览器结果和复核记录见 [browser-checks.json](browser-checks.json)，公开 API 通过 API Extractor 检查，快照见 [public-api.api.md](public-api.api.md)。

规范变更前扫描 required 18 通过、0 失败；变更后完整报告见 [sdk-standard-after.json](sdk-standard-after.json)。
门户产品代码未改动，本轮不涉及远程仓库、发布流程或托管状态核验。

首次将 Demo 测试强制放到完整 Chromium 时出现视频帧和 Canvas 精确像素断言失败；在未改动基线上复现同样现象。
按仓库原配置使用 Chromium Headless Shell 后，视频及缓存用例全部通过。真实 GPU 的 24 组验证始终使用完整 Chromium。

## 画面与待验收项

[桌面画面](demo-desktop.png) / [390px 画面](demo-mobile.png) 使用真实 PP-YOLOE FP32 输出。
截图中的模型请求从已校验的本地资产返回，不属于 ModelScope 网络分发测试。
页面没有新增说明面板，状态行显示进度，模型来源仍默认 ModelScope。

2026-09-13，用户在小米 15 局域网 HTTPS 测试之后反馈：“基本上是对的”。对应实现为 `ad734f2`，记为用户实机总体反馈基本正常，详见 [手动验证清单](xiaomi-15-checklist.md)。
本次反馈未逐项列明模型、精度、实际后端、浏览器版本、摄像头和取消/清理行为，因此不据此补齐兼容矩阵或勾选全部测试项。
增强可能增加误检和耗时，严格误检门槛仍未通过，因此保持实验、默认关闭。
