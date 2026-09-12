# Performance

[中文](../zh-CN/performance.md)

Metrics have two independent scopes. `detector.loadTimings` starts at factory entry and includes capability probing, manifest retrieval, model download or cache access, integrity verification, and Session creation. `totalMs` is initialization wall-clock time. `sessionMs` includes runtime imports, Worker startup, and failed candidates attempted during initialization. In-memory models also measure integrity verification.

`modelSource` is `network`, `cache`, or `memory`: downloaded bytes, a cache hit, or bytes supplied by the caller. A cache hit still needs verification and a new session; it is different from reusing a loaded session. The new optional fields are available from 0.2.0; see the [release notes](release-0.2.0.md) for version changes.

`result.timings` records only the current image or video frame: decode, preprocessing, inference, and postprocessing. `totalMs` is the end-to-end wall-clock duration, including Worker communication, scheduling, and transfer overhead. Reusing a session does not add historical initialization again. A fallback during inference includes rebuilding and retrying in that operation's inference and total durations; the original initialization record remains unchanged.

Each result snapshots its actual backend, precision, execution mode, and fallback history. `runtimeVersion` comes from the loaded ORT module's `env.versions.web`; a custom runtime without this information reports `null`. `environment` captures the browser's public `userAgent`, `platform`, and `capturedAt` during initialization; unavailable values are `null`. This describes the current run, not a compatibility guarantee.

The current default model is PicoDet-L-320 1.0.1 FP32. See [compatibility](compatibility.md) for dated WASM/WebGPU environments and seven-fixture evidence. FP16 is blocked and INT8, INT4, and FP8 are labs. Historical FP16 records for other models do not establish support for the current Detection model. One measurement on one device is not a universal benchmark.

Prioritize detector reuse, IndexedDB caching, avoiding concurrent large sessions, submitting one frame at a time, cancellation, and resource release. Label network initialization, cache initialization, and session reuse separately; do not treat first session creation as steady-state inference throughput.

本次尚未发布的 bicubic 优化在固定 64 图、桌面主线程测试中，PP-YOLOE WebGPU 三轮热端到端中位数降低 25.5%，预处理中位数降低 54.4%；两款模型在相同后端的新旧预测逐项一致。环境、逐轮数据、复现与手机验证清单见 [2026-09-12 预处理评测](../../reports/evaluation/2026-09-12-preprocess/README.md)。尚未验证本次实现的小米 15 性能，也未测峰值内存。
