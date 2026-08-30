# PP-Detection FP32 稳定发布实施计划

> **执行说明：** 按 TDD 顺序逐步执行，每个行为先写失败测试，再修改最小实现并运行验证。

**目标：** 将 PP-Detection 1.0.1 的 FP32 ONNX 模型作为 SDK v0.1.0 的唯一稳定默认模型，并保留 FP16/量化版本的实验或阻塞状态。

**架构：** 1.0.1 清单声明单个 FP32 变体，固定包含 WASM、WebGPU 以及 Git LFS、Hugging Face、ModelScope 三类不可变来源。发布脚本按 SDK 发布版本映射到 1.0.1，只验证该变体的文件哈希、来源、FP32 CPU/浏览器证据，不再要求 FP16 通过。Demo、默认 manifest URL 和双语文档同步到该稳定模型。

**技术栈：** TypeScript、Node.js test runner、Vitest、Playwright、ONNX Runtime Web、pnpm。

**依据：** `standards/v1/README.md`、`sdk-contract.md`、`docs-release-contract.md`、`sdk-manifest.schema.json`。

## 全局约束

- 仅 FP32 进入 stable；FP16、INT8、INT4、FP8 不得写成稳定兼容承诺。
- 变体必须声明 `precision`、`quantization`、`opset`、`bytes`、`parameterCount`、`backends` 和来源。
- 来源只允许 `git-lfs`、`huggingface`、`modelscope`、`custom`，revision 必须不可变，来源大小和 SHA-256 必须与变体一致。
- 显式来源失败不得静默换源；`auto` 才能按清单顺序尝试。
- 文档、提交信息和注释使用中文；不得写入 ModelScope token。

## 任务

### 任务 1：先补发布契约测试

**修改：** `scripts/verify-release.test.mjs` 及相关测试。

- 增加断言：默认 release 使用 `models/pp-detection/1.0.1/manifest.json`。
- 增加断言：FP32-only 变体可通过稳定来源和浏览器证据校验。
- 增加断言：FP16 缺失或阻塞不影响 1.0.1 发布门禁。
- 运行对应测试，确认在实现修改前按预期失败。

### 任务 2：更新 1.0.1 清单和证据

**修改：** `models/pp-detection/1.0.1/manifest.json`、`README.md`、`source.yaml`、必要的报告文件。

- 使用候选文件 `picodet-l-320-fp32.onnx` 的实际大小 `23243834` 和 SHA-256 `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。
- 仅声明 `fp32`、`quantization: none`、`backends: [wasm, webgpu]`，并绑定三类不可变来源。
- 重新核对报告中的模型大小、哈希、fixture 顺序和 accepted output；不复用与候选哈希不一致的旧证据。

### 任务 3：修改 release gate

**修改：** `scripts/verify-release.mjs`。

- `v0.1.0` release 默认验证 1.0.1。
- 只验证 1.0.1 FP32 validation、WASM/WebGPU evidence 和三类来源。
- 保留显式 `--models` 版本验证能力，但不为 1.0.1 无条件要求 FP16。

### 任务 4：同步 SDK、Demo 和文档

**修改：** SDK 默认 manifest URL、Demo 版本/来源展示、双语模型和性能文档、根 README、CHANGELOG。

- 默认 URL 指向 1.0.1。
- 明确 FP32 stable、FP16/量化为 labs/blocked，并记录验证日期与环境。
- 保持 runtime 框架无关，示例继续覆盖图片、视频、摄像头和 H5/WebView。

### 任务 5：完整验证和集成

- 运行 `pnpm sdk:check -- --repo F:/git/00_chenmohan/github/web-sdk-PP-Detection`。
- 运行 `pnpm verify`、release 测试、`node scripts/verify-release.mjs --release v0.1.0` 和打包浏览器 smoke test。
- 仅在所有 required 门禁通过后提交中文 commit、推送分支并更新 PR；不自动创建 tag 或发布 npm，除非用户另行确认。
