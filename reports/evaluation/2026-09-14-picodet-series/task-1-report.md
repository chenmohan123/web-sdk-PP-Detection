# 任务 1 报告

已完成清理与检查 API 的 `input_size` 参数化，支持 320、416、640，默认仍为 320，非法尺寸会明确拒绝；新增尺寸契约测试。准备脚本已修正工作区根路径，下载后逐图清理并检查，生成八个候选及已有 L-320 参考共九项 jobs，模型文件仅写入 `.tmp/picodet-series/`。

验证：在工作区可写临时目录执行 `pytest -q tools/model-pipeline/tests/test_picodet_series.py --basetemp .tmp/pytest-final`，结果为 9 passed。8 个官方图已下载并记录原始 bytes/SHA，清理后候选与 jobs.json 的 bytes/SHA 已逐项核对；已有 L-320 文件未纳入提交。门户标准检查 required 失败 0，状态为 locally-compliant。

风险：逐图 ONNX Runtime 与官方参考输出、浏览器 WASM/WebGPU 评测尚未完成；候选清单保持 `labs`，不宣称浏览器、手机或 NPU 兼容性，也未上传 ModelScope/Hugging Face。
