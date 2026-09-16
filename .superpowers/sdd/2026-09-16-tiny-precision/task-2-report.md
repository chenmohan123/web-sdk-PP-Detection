# Task 2：Tiny 达标变体分发与 SDK Demo

日期：2026-09-16。分支：`codex/tiny-precision`。BASE：`c8b3e2a`。本报告对应 Task 2，不代表已 push 或创建 PR。

## 状态

已完成 FP16 0.1.1 双 Hub 上传、GET 回读、稳定清单、SDK Demo/文档/测试集成，以及 8 组合真实浏览器分发验证。W8A32 未发布，未进入稳定目录或 Demo。最终变更保留既有 `task-1-report.md` 修复记录。

## 发布结果

- FP16：2,357,376 字节，SHA-256 `331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc`。
- ModelScope 权重 revision：`f8641fe3a12e62c93af8e8b3397abfb1b78746f7`；最终元数据 revision：`6b4e6e46e0515e77735ff2b98b01dac9b447a73b`。
- Hugging Face 权重 revision：`b00cf78779aeb8a9ebcdaba72f23b5e72639c1c9`；最终元数据 revision：`3e508a8b66e7bd1ef865404623d9bdc49f0040a9`。
- 稳定清单含 FP32 与 FP16，共 14 个规格、39 个稳定变体；默认 PicoDet-L-320 / FP32 / ModelScope；SDK/npm 0.4.0 未变。
- W8A32：SHA-256 `9317cbfaf2f36b22430f1cf12c3bd00289458c3878aa3a9d1b34131264b99b53`，AP 最差变化 -0.537364 点、保留率 0.966346，拒绝发布。

首次 ModelScope 元数据回读的 CRLF/LF 差异已归档为失败证据，恢复工具统一双源 LF 后最终回读通过；未修改权重阶段收据或调用旧 FP32 上传入口。

## 验证

- 发布器与恢复工具拒绝测试：28 passed。
- SDK 单测：206 passed；`release:test`：29 passed；`docs:test`：5 passed；`examples:check`：12 passed；`benchmark:test`：6 passed。
- Demo 浏览器测试：17 passed；本地 Demo 双源 × WASM/WebGPU 4 组合真实检测通过，桌面/390px 视口无横向溢出，导出 JSON 版本和 SHA 正确。
- PicoDet/Task 1 定向模型管线测试：62 passed（phase2 数值栈，附加默认环境 transformers 路径）。
- SDK build、Demo build、根 typecheck、Demo typecheck、lint 均通过。
- 门户标准检查：`standardVersion 1.1.0`，required 18 passed、0 failed、4 skipped（需远程治理 API），recommended 3 passed，状态 `locally-compliant`。
- 8 组合证据：`reports/distribution/2026-09-16-tiny-precision/browser.json`；生命周期：`lifecycle-candidates.json`；本地 Demo：`demo-local/`。

## 环境阻断与风险

- 根 `format:check` 无法遍历工作树中权限受限的 `.pytest_cache`；对本轮可解析的 Git 变更源文件执行了显式 Prettier 检查。生成的 Python/部分原始证据不由 Prettier 解析。
- `lifecycle-candidates.mjs` 是准备收据按 SHA-256 绑定的原始执行快照，保留运行时 EOF 空行；除该不可变快照外，暂存差异通过 `git diff --check`。
- 全量 `tools/model-pipeline` 收集到 126 passed、29 failed；失败均为未恢复的历史 PP-DocLayout 资产（ONNX/manifest 缺失），不是本轮 Tiny 变更。相关定向 PicoDet 测试已单独通过。
- 评测与浏览器证据固定于 Windows 11、Chromium 153、ORT Web 1.27.0 和固定 64 图；不外推手机、NPU、全量 COCO 或其他浏览器。
- 不 push、不建 PR，由控制器独立审查和合并。
