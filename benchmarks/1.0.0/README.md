# 0.1.0 基准证据 / 0.1.0 Benchmark Evidence

当前 `runtime.json` 记录的是 PicoDet-L-320 模型资产门禁，而不是已通过的
浏览器性能报告。仓库中尚未放入真实 PicoDet ONNX 文件，因此 `status` 为
`blocked`，`releaseReady` 为 `false`。

The current `runtime.json` records the PicoDet-L-320 model asset gate rather
than a passing browser performance report. No real PicoDet ONNX file is present
in this repository, so `status` is `blocked` and `releaseReady` is `false`.

完成模型导出后，必须重新采集 CPU/WASM、GPU/WebGPU 的冷启动、热缓存、推理
耗时、输出一致性和浏览器环境证据；INT8、INT4、FP8 只有在对应量化与浏览器
验证完成后才能加入 stable 变体。不得复用 PP-DocLayoutV3 等其他模型的报告。

After model export, collect fresh CPU/WASM and GPU/WebGPU cold-start, warm-cache,
inference, output-parity, and browser-environment evidence. INT8, INT4, and FP8
may enter a stable variant only after their quantization and browser checks pass.
Reports from other models such as PP-DocLayoutV3 must not be reused.
