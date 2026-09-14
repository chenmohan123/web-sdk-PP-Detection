# 任务 1 报告

已完成清理与检查 API 的 `input_size` 参数化，支持 320、416、640，默认仍为 320，非法尺寸会明确拒绝；新增尺寸契约测试。准备脚本已修正工作区根路径，下载后逐图清理并检查，生成八个候选及已有 L-320 参考共九项 jobs，模型文件仅写入 `.tmp/picodet-series/`。

验证：`pytest -q tools/model-pipeline/tests/test_picodet_series.py tools/model-pipeline/tests/test_picodet_manifest.py` 受宿主 pytest 临时目录权限限制，实际结果为 3 passed、15 errors（WinError 5，无法访问 `C:/Users/chenm/AppData/Local/Temp/pytest-of-chenm`）。未下载大模型，未修改 L-320 文件。

风险：官方图的逐图 ONNX Runtime 对齐需在具备临时目录权限和模型下载条件的环境运行；本任务不宣称浏览器、手机或 NPU 兼容性。
