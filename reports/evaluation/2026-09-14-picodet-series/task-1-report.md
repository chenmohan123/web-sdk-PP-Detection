# 任务 1 报告

已完成清理与检查 API 的 `input_size` 参数化，支持 320、416、640，默认仍为 320，非法尺寸会明确拒绝；新增尺寸契约测试。准备脚本下载官方后处理图后，先执行单输入清理，再执行 PicoDet WebGPU 兼容清理，最终候选图写入 `.tmp/picodet-series/`，生成八个新增规格及已有 L-320 共九项 jobs。

任务 1 验证：`pytest -q tools/model-pipeline/tests/test_picodet_series.py --basetemp .tmp/pytest-final` 结果为 9 passed；WebGPU 清理器测试为 14 passed，Parity 与清理回归测试为 18 passed。官方图、最终候选图及 `jobs.json` 的 bytes/SHA 已逐项核对。

任务 2 验证：九个规格各完成固定 64 图的 WASM 和 WebGPU 浏览器评测，均为 64/64 通过；九个规格逐图官方/候选 ORT 对齐均为 64/64 通过。对齐保留全量误差，判定要求类别序列一致、分数最大差 `1e-3`，以及置信度不低于 `0.5` 的框坐标最大差不超过 `0.5` 像素。详见同目录 `README.md` 和 `summary.json`。

8 个新增规格已上传 ModelScope 与 Hugging Face，并回读固定 revision、HTTP 状态、bytes 与 SHA-256；最终清单为 `stable`/`1.0.0`，默认 ModelScope。移动端、NPU 和其他浏览器也不属于本轮证据。门户标准检查需在最终清单接入后重新执行。
