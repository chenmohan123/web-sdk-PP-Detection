# 性能

[English](../en/performance.md)

性能指标分成两个独立范围。`detector.loadTimings` 记录一次初始化，从工厂入口开始计时，覆盖能力探测、manifest 获取、模型下载或缓存读取、完整性校验和 Session 创建；`totalMs` 是整个初始化过程的墙钟时间。`sessionMs` 包含运行时导入、Worker 启动及初始化期间失败候选的尝试时间。内存模型同样测量完整性校验。

`modelSource` 为 `network`、`cache` 或 `memory`，分别表示网络获取、缓存命中、调用方传入模型字节。缓存命中仍需校验和创建会话，不等于复用已经加载的会话。可选新增字段从 0.2.0 起提供，版本变更见[发布说明](release-0.2.0.md)。

`result.timings` 只记录当前图片或视频帧的解码、预处理、推理和后处理。`totalMs` 是本次处理的端到端墙钟时间，包含 Worker 通信、调度和传输等开销；复用会话时不会再次计入历史初始化。推理期间发生后端回退，其会话重建和重试属于本次处理，保留在本次推理及总耗时中，原有初始化记录不改写。

每次结果的 `runtime` 保留当次实际后端、精度、执行模式和回退记录快照。`runtimeVersion` 来自实际载入 ORT 的 `env.versions.web`；自定义运行时没有该信息时为 `null`。`environment` 记录初始化时浏览器公开的 `userAgent`、`platform` 及 `capturedAt`，字段不可获取时为 `null`。这描述当前运行环境，不是设备兼容性承诺。

当前默认模型是 PicoDet-L-320 1.0.1 FP32，已验证的 WASM/WebGPU 环境与七张 fixture 证据见[兼容性](compatibility.md)。FP16 当前为 blocked，INT8、INT4、FP8 为 labs；历史其他模型的 FP16 记录不代表当前 Detection 模型支持。不能以一次测试或单台设备的耗时代表普遍性能。

优化优先级：复用检测器、启用 IndexedDB、避免同时创建多个大模型会话、逐帧等待上一帧完成、允许取消并正确释放。分别记录网络初始化、缓存初始化与会话复用运行，不用首轮会话创建时间代表稳定推理吞吐。

0.3.1 的 bicubic 优化在固定 64 图、桌面主线程测试中，PP-YOLOE WebGPU 三轮热端到端中位数降低 25.5%，预处理中位数降低 54.4%；两款模型在相同后端的新旧预测逐项一致。环境、逐轮数据、复现与手机验证清单见 [2026-09-12 预处理评测](../../reports/evaluation/2026-09-12-preprocess/README.md)。小米 15 用户已确认两款模型 CPU/GPU 基础功能回归正常，见[实机记录](../../reports/releases/2026-09-12-0.3.1/mobile-xiaomi15.md)；没有手机旧版对照，不能据单次截图计算提速，峰值内存仍未测量。
