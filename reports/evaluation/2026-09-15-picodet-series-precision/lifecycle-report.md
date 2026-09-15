# 生命周期验证入口

`lifecycle-check.mjs` 按 job 精度 ID 选择变体，覆盖 WASM/WebGPU × main/Worker 的检测、预取消、恢复和 dispose 后拒绝调用。结果绑定模型、清单、SDK 与 people.jpg 的 SHA，核验物理 GPU 身份及 main/Worker 检测一致性。

使用 `PICODET_LIFECYCLE_JOBS` 指定 jobs 路径，`PICODET_LIFECYCLE_OUTPUT` 指定输出文件名。候选允许 labs，正式清单关闭实验开关。

发布前执行 accepted-jobs.json，输出 lifecycle-candidates.json；最终双源清单生成后执行 published-jobs.json，输出 lifecycle-published.json。remote-smoke.mjs 从两个显式来源实际下载，验证 SHA/CORS 与 WASM 推理。结论以实际 JSON 为准。
