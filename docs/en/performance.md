# Performance

[中文](../zh-CN/performance.md)

Metrics have two independent scopes. `detector.loadTimings` starts at factory entry and includes capability probing, manifest retrieval, model download or cache access, integrity verification, and Session creation. `totalMs` is initialization wall-clock time. `sessionMs` includes runtime imports, Worker startup, and failed candidates attempted during initialization. In-memory models also measure integrity verification.

`modelSource` is `network`, `cache`, or `memory`: downloaded bytes, a cache hit, or bytes supplied by the caller. A cache hit still needs verification and a new session; it is different from reusing a loaded session. The new optional fields belong to current source and are not yet included in public npm 0.1.1.

`result.timings` records only the current image or video frame: decode, preprocessing, inference, and postprocessing. `totalMs` is the end-to-end wall-clock duration, including Worker communication, scheduling, and transfer overhead. Reusing a session does not add historical initialization again. A fallback during inference includes rebuilding and retrying in that operation's inference and total durations; the original initialization record remains unchanged.

Each result snapshots its actual backend, precision, execution mode, and fallback history. `runtimeVersion` comes from the loaded ORT module's `env.versions.web`; a custom runtime without this information reports `null`. `environment` captures the browser's public `userAgent`, `platform`, and `capturedAt` during initialization; unavailable values are `null`. This describes the current run, not a compatibility guarantee.

The current default model is PicoDet-L-320 1.0.1 FP32. See [compatibility](compatibility.md) for dated WASM/WebGPU environments and seven-fixture evidence. FP16 is blocked and INT8, INT4, and FP8 are labs. Historical FP16 records for other models do not establish support for the current Detection model. One measurement on one device is not a universal benchmark.

Prioritize detector reuse, IndexedDB caching, avoiding concurrent large sessions, submitting one frame at a time, cancellation, and resource release. Label network initialization, cache initialization, and session reuse separately; do not treat first session creation as steady-state inference throughput.
