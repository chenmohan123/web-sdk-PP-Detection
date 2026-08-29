# Hugging Face 默认分发与真实 WebGPU 验证实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 PP-Detection 的公共模型分发默认切换为 Hugging Face，保留 ModelScope 和 Git LFS 可选来源，并在真实 NVIDIA WebGPU runner 上形成可审计的浏览器验证链路。

**架构：** runtime manifest 继续作为模型身份、变体、来源和完整性校验的唯一事实源；来源顺序由 manifest 固定为 Hugging Face、ModelScope、Git LFS，显式来源绝不自动换源。Demo 以 Hugging Face 为初始来源，SDK 返回实际来源摘要；普通 CI 不再拉取 Git LFS，模型验证和 WebGPU 工作流从固定 revision 的外部来源下载并校验模型。

**技术栈：** TypeScript、React Demo、onnxruntime-web 1.27.0、Python 3.11、ONNX、Playwright、GitHub Actions、Hugging Face Hub、ModelScope。

**规格：** `docs/superpowers/specs/2026-08-29-huggingface-default-webgpu-design.md`

## 全局约束

- 在来源、许可、WASM、物理 WebGPU 和跨输入证据完整前，`models/pp-detection/1.0.0/manifest.json` 保持 `labs/blocked`。
- Hugging Face 是 Demo 默认来源；ModelScope 是国内镜像；Git LFS 不是 Demo 默认来源。
- 每个来源必须记录 40 至 64 位十六进制不可变 revision、HTTPS 下载 URL、bytes 和 64 位 SHA-256。
- 显式 `source` 失败时返回错误，不静默换源；只有 `auto` 才按 manifest 顺序尝试来源。
- 不把任何 ModelScope、Hugging Face 或 GitHub token 写入文件、命令参数、日志、报告或提交。
- GitHub Actions 普通 CI、模型验证和物理 WebGPU 验证均不依赖 GitHub LFS 下载模型本体。
- runtime 不依赖 React/Vue；Demo 必须继续支持图片、视频和摄像头。
- 所有文档、代码注释、提交信息和用户可见新增文案使用中文；英文文档同步维护。
- 历史 `1.0.0` 模型和既有报告不得覆盖、删除或复用哈希。

---

### 任务 1：SDK 来源摘要和来源顺序契约

**文件：**
- 修改：`packages/sdk/src/types.ts` 的模型信息和来源类型
- 修改：`packages/sdk/src/index.ts` 的 `modelInfo`、模型加载返回值和结果组装
- 修改：`packages/sdk/src/model/source-resolver.ts` 的 `auto` 顺序注释/测试辅助
- 测试：`packages/sdk/tests/source-resolver.test.ts`、`packages/sdk/tests/detector.test.ts`

**接口：**
- 消费：现有 `RuntimeDetectionManifest.variants[].sources[]`、`CreatePPDetectionOptions.source`、`ModelManager.load()`。
- 产出：`PPDetectionModelInfo.source: { kind: ModelSourceKind; revision: string; bytes: number; sha256: string }`；`ModelManager` 的 `LoadedManagedModel.source` 继续作为实际来源。

- [ ] **步骤 1：先写失败测试**

在来源解析测试中加入以下行为断言：

```ts
expect(resolveModelSources(variant, "auto").map(({ kind }) => kind)).toEqual([
  "huggingface",
  "modelscope",
  "git-lfs"
]);
await expect(loadWithSource("huggingface")).rejects.toMatchObject({
  code: "MODEL_SOURCE_UNAVAILABLE"
});
```

在 detector 测试中断言成功结果包含实际来源的 `kind`、`revision`、`bytes` 和 `sha256`，且 source URL 的查询参数不会出现在公开结果中。

- [ ] **步骤 2：运行失败测试**

运行：`pnpm --filter web-sdk-pp-detection test -- source-resolver detector`

预期：新断言失败，现有 `auto` 顺序仍取决于输入数组且 `PPDetectionModelInfo` 没有 source 摘要。

- [ ] **步骤 3：实现最小来源摘要**

在 `packages/sdk/src/types.ts` 增加：

```ts
export interface PPDetectionModelSourceInfo {
  readonly kind: ModelSourceKind;
  readonly revision: string;
  readonly bytes: number;
  readonly sha256: string;
}
```

给 `PPDetectionModelInfo` 增加只读 `source` 字段；调整 `modelInfo(runtime, variantId, source)` 接收已解析来源并只复制上述四个公开字段。`createPPDetection` 在内存模型和 `ModelManager.load()` 两条路径都传入实际 source；worker 返回的模型信息使用同一摘要。来源 resolver 保持“显式只返回一个来源、auto 保持 manifest 顺序”的语义。

- [ ] **步骤 4：运行通过测试**

运行：`pnpm --filter web-sdk-pp-detection test -- source-resolver detector`。

预期：来源解析和 detector 相关测试全部通过，已有 95 个 SDK 测试不减少。

- [ ] **步骤 5：提交**

```powershell
git add packages/sdk/src/types.ts packages/sdk/src/index.ts packages/sdk/src/model/source-resolver.ts packages/sdk/tests/source-resolver.test.ts packages/sdk/tests/detector.test.ts
git commit -m "补充模型实际来源摘要"
```

### 任务 2：外部来源 manifest 与模型管线

**文件：**
- 修改：`tools/model-pipeline/picodet/build_manifest.py`
- 创建：`tools/model-pipeline/picodet/source_evidence.py`
- 修改：`tools/model-pipeline/tests/test_picodet_manifest.py`
- 创建：`tools/model-pipeline/tests/test_source_evidence.py`
- 修改：`tools/model-pipeline/reports/picodet-source-evidence.json`
- 修改：`models/pp-detection/1.0.0/source.yaml`

**接口：**
- 消费：每个变体的本地 ONNX 文件和外部来源配置；来源配置字段为 `kind`、`repository`、`revision`、`path`、`downloadUrl`、`bytes`、`sha256`。
- 产出：按 Hugging Face、ModelScope、Git LFS 排序的来源证据；`build_manifest` 生成的 runtime manifest 与所有来源字节/哈希一致。

- [ ] **步骤 1：写来源配置失败测试**

测试 `source_evidence.py` 拒绝以下输入：移动的 `main` URL、非十六进制 revision、bytes 不匹配、SHA-256 不匹配、缺少 Hugging Face 或 ModelScope；并接受当前已核验的三组 revision。

- [ ] **步骤 2：运行失败测试**

运行：`python -m pytest tools/model-pipeline/tests/test_source_evidence.py -q`。

预期：模块尚未存在，测试失败。

- [ ] **步骤 3：实现来源验证器**

实现 `validate_source(source, artifact_bytes, artifact_sha256)` 和 `order_sources(sources)`：校验 HTTPS 主机、revision 正则、正整数 bytes、64 位 SHA-256，并按固定顺序返回 `huggingface`、`modelscope`、`git-lfs`。验证器不得发出网络请求，也不得读取环境中的 token。

- [ ] **步骤 4：接入清单生成器**

让 `build_manifest.py` 接受按 precision 分组的来源证据，按固定顺序写入 `variants[].sources[]`，并在 blocked 结果的 reason 中说明“外部来源证据未满足”而不是声称来源未上传。stable 变体仍要求三类来源完整且实际文件存在；没有浏览器证据时继续输出 blocked/labs，不把来源上传等同于 stable。

- [ ] **步骤 5：运行模型清单测试**

运行：`python -m pytest tools/model-pipeline/tests/test_picodet_manifest.py tools/model-pipeline/tests/test_source_evidence.py -q`。

预期：来源顺序、revision、bytes、SHA-256 和 blocked 门槛测试通过。

- [ ] **步骤 6：提交**

```powershell
git add tools/model-pipeline/picodet/build_manifest.py tools/model-pipeline/picodet/source_evidence.py tools/model-pipeline/tests/test_picodet_manifest.py tools/model-pipeline/tests/test_source_evidence.py tools/model-pipeline/reports/picodet-source-evidence.json models/pp-detection/1.0.0/source.yaml
git commit -m "固定外部模型来源清单顺序"
```

### 任务 3：PicoDet FP32 WebGPU 清理和版本化资产准备

**文件：**
- 创建：`tools/model-pipeline/picodet/sanitize_webgpu_fp32.py`
- 创建：`tools/model-pipeline/tests/test_sanitize_webgpu_fp32.py`
- 创建：`models/pp-detection/1.0.1/` 下的模型、清单、来源说明和标签文件
- 创建：`tools/model-pipeline/reports/1.0.1/sanitize.json`、`fp32-validation.json`、`variant-validation.json`
- 修改：`tools/model-pipeline/pyproject.toml` 或模型依赖锁（仅当新增依赖确实需要）

**接口：**
- 消费：`models/pp-detection/1.0.0/picodet-l-320-fp32.onnx` 或同一 SHA-256 的外部下载副本。
- 产出：`sanitize_webgpu_fp32(source: Path, target: Path) -> { bytes: int; sha256: str }`；版本化 `1.0.1` FP32/FP16 资产和独立报告。

- [ ] **步骤 1：写清理器失败测试**

使用合成 ONNX 图覆盖：缺少 `sin/cos/sin_1/cos_1`、形状不是 `[625,64]`、`node_cat_7` 或 `node__to_copy_4` 拓扑改变、Cast 目标不是 FLOAT、存在额外 DOUBLE initializer，以及转换后仍有 DOUBLE value。每个失败用例断言目标文件不存在。

- [ ] **步骤 2：运行失败测试**

运行：`python -m pytest tools/model-pipeline/tests/test_sanitize_webgpu_fp32.py -q`。

预期：清理器尚未存在，测试失败。

- [ ] **步骤 3：实现失败关闭的清理器**

在 ONNX checker 通过后只转换四个已知 initializer 的 payload 为 FLOAT，保留名称和形状；验证 `node_cat_7` 后紧接 `node__to_copy_4` Cast；转换后运行 checker、shape inference 和 DOUBLE 扫描；使用临时文件写入后原子替换，并返回实际 bytes/SHA-256。

- [ ] **步骤 4：运行清理器测试和真实模型结构测试**

运行：`python -m pytest tools/model-pipeline/tests/test_sanitize_webgpu_fp32.py tools/model-pipeline/tests/test_onnx_contract.py -q`。

预期：合成图拒绝测试、字节可复现测试、真实模型无 DOUBLE 路径测试通过。

- [ ] **步骤 5：生成 1.0.1 候选并执行 CPU/WASM 验证**

用清理器生成 `models/pp-detection/1.0.1/picodet-l-320-fp32.onnx`，保留已接受的 FP16 文件；使用现有七张 fixture 的脚本分别比较旧 FP32 与新 FP32 的检测数量、标签顺序、阅读顺序、坐标、polygon、score 和 raw output。运行本地 WASM smoke，报告绑定新文件的 bytes/SHA-256。

- [ ] **步骤 6：未通过时保持 blocked；通过时生成报告**

任何 CPU、WASM 或结构门槛失败都不生成 stable variant。只有全部通过才生成 `1.0.1` 报告，并将报告中的 browser/runner 字段留给任务 5 填入真实硬件证据。

- [ ] **步骤 7：提交候选和报告**

```powershell
git add tools/model-pipeline/picodet/sanitize_webgpu_fp32.py tools/model-pipeline/tests/test_sanitize_webgpu_fp32.py models/pp-detection/1.0.1 tools/model-pipeline/reports/1.0.1
git commit -m "生成 PicoDet WebGPU 清理候选"
```

### 任务 4：Demo 默认来源和来源信息展示

**文件：**
- 修改：`apps/demo/src/model-sources.ts`
- 修改：`apps/demo/src/App.tsx`
- 修改：`apps/demo/src/i18n/zh-CN.ts`
- 修改：`apps/demo/src/i18n/en.ts`
- 修改：`apps/demo/src/styles.css`
- 修改：`apps/demo/tests/demo.spec.ts`

**接口：**
- 消费：任务 1 的 `PPDetectionModelInfo.source`、外部 runtime manifest URL 和 `CreatePPDetectionOptions.source`。
- 产出：`DEFAULT_MODEL_SOURCE = "huggingface"`；来源选择器（`huggingface`、`modelscope`、`git-lfs`、`default`）、来源 manifest URL、实际来源、revision、bytes、SHA-256 和 blocked 状态的双语展示。

- [ ] **步骤 1：更新 Demo 契约测试**

把来源测试改为断言默认值为 `huggingface`；选项顺序为 `huggingface`、`modelscope`、`git-lfs`、`default`，其中 `default` 只作为兼容别名。测试固定 revision manifest URL 必须包含 Hugging Face `resolve/<revision>/`，ModelScope URL 必须包含 `/resolve/<revision>/`，Git LFS URL 必须使用固定提交的 GitHub media 地址；在当前 `labs/blocked` 资产未完成前，选项显示阻塞原因而不是伪造可用状态。

- [ ] **步骤 2：运行失败测试**

运行：`pnpm --filter demo test -- demo.spec.ts`。

预期：现有默认值为 `default`，来源测试失败。

- [ ] **步骤 3：实现来源配置和切换**

将 `DEFAULT_MODEL_SOURCE` 改为 `huggingface`，把 `selectionToModel()` 的输入映射到外部 runtime manifest URL；`onModelSource()` 继续释放 detector、停止视频/摄像头并清空当前结果。初始化 SDK 时同时传 `model` manifest URL 和 `source: modelSource`，fixture 模式仍使用内存 tiny model。

- [ ] **步骤 4：展示实际来源和模型信息**

在模型信息区增加请求来源、实际来源、revision、bytes、SHA-256；没有结果时显示清单来源和 blocked 限制。所有新增字段使用 `data-sdk-model-info` 区域，长 revision/摘要使用可换行样式，不造成 390px 横向溢出。

- [ ] **步骤 5：运行 Demo 测试**

运行：`pnpm --filter demo test -- demo.spec.ts` 和 `pnpm --filter demo build`。

预期：图片、视频、摄像头、语言切换、缓存清理、CPU/GPU 控件和来源选择测试通过；fixture 模式不访问外部模型 URL。

- [ ] **步骤 6：提交**

```powershell
git add apps/demo/src/model-sources.ts apps/demo/src/App.tsx apps/demo/src/i18n/zh-CN.ts apps/demo/src/i18n/en.ts apps/demo/src/styles.css apps/demo/tests/demo.spec.ts
git commit -m "将 Demo 默认模型来源切换为 Hugging Face"
```

### 任务 5：外部模型下载验证和普通 CI 脱离 Git LFS

**文件：**
- 创建：`scripts/fetch-model-source.mjs`
- 修改：`tests/browser/benchmark.spec.ts`、`tests/browser/runtime.spec.ts`
- 修改：`.github/workflows/ci.yml`
- 修改：`.github/workflows/benchmark.yml`
- 修改：`.github/workflows/model-validation.yml`
- 修改：`scripts/verify-release.mjs`、`scripts/verify-release.test.mjs`

**接口：**
- 消费：`PPDETECTION_MODEL_MANIFEST_URL`、`PPDETECTION_MODEL_SOURCE`、manifest 中的固定 source URL。
- 产出：下载到临时目录并返回 `{ manifestPath, modelPath, sourceKind, sha256 }` 的脚本；所有普通/模型/基准工作流 `actions/checkout` 使用 `lfs: false`。

- [ ] **步骤 1：写下载器失败测试**

测试本地 HTTP fixture：非 2xx、重定向到非 HTTPS、缺少 manifest source、Content-Length 不匹配、SHA-256 不匹配和显式 Hugging Face 失败时不得尝试 ModelScope；成功时返回临时路径并删除临时目录中的凭据文件。

- [ ] **步骤 2：实现下载器**

使用 Node `fetch` 和 `crypto.createHash`；只接受 HTTPS Hugging Face、ModelScope、GitHub media Git LFS URL 或清单声明的 custom URL；先解析 manifest，再按 `PPDETECTION_MODEL_SOURCE` 选择 source；显式来源失败立即退出，`auto` 才按顺序继续；错误消息移除查询参数和 Authorization 信息。

- [ ] **步骤 3：改造浏览器基准**

`tests/browser/benchmark.spec.ts` 在 `PPDETECTION_MODEL_MANIFEST_URL` 存在时调用下载器生成临时测试资产，旧的本地路径仅在本地 blocked/fixture 模式下使用。测试把 source kind、manifest revision、模型 SHA-256 和实际 backend 写入 JSON 报告。

- [ ] **步骤 4：修改工作流 checkout 和环境变量**

普通 `ci.yml`、`benchmark.yml`、`model-validation.yml` 的 checkout 设置 `lfs: false`；模型验证在 `pnpm install` 后运行下载器，从外部固定 revision 取模型；模型验证仍拒绝 blocked manifest。工作流日志只输出来源 kind、revision 和 SHA-256。

- [ ] **步骤 5：运行本地下载和发布契约测试**

运行：`pnpm release:test`、`pnpm benchmark:test`、`pnpm benchmark:parity`。

预期：下载器、发布契约、基准契约和 tiny-model parity 全部通过；Windows 若出现已知临时文件 EPERM，记录具体命令和环境，不修改测试门槛。

- [ ] **步骤 6：提交**

```powershell
git add scripts/fetch-model-source.mjs tests/browser/benchmark.spec.ts tests/browser/runtime.spec.ts .github/workflows/ci.yml .github/workflows/benchmark.yml .github/workflows/model-validation.yml scripts/verify-release.mjs scripts/verify-release.test.mjs
git commit -m "让模型验证使用外部固定来源"
```

### 任务 6：接入真实 NVIDIA WebGPU runner

**文件：**
- 修改：`.github/workflows/ci.yml`
- 修改：`.github/workflows/benchmark.yml`
- 修改：`tests/browser/runtime.spec.ts`
- 创建：`tools/model-pipeline/reports/1.0.1/webgpu-evidence.json`
- 修改：`docs/zh-CN/compatibility.md`、`docs/en/compatibility.md`

**前置外部设置：** 将 `windows-nvidia-webgpu` runner 注册到 `web-sdk-PP-Detection` 或组织级共享 runner；确认标签为 `self-hosted`、`Windows`、`X64`、`webgpu-hardware`；在 Detection 仓库设置 Actions 变量 `RUN_WEBGPU_HARDWARE=true`。这些设置通过 GitHub UI/API 完成，不写入仓库。

- [ ] **步骤 1：写物理 runner 测试入口**

扩展 `tests/browser/runtime.spec.ts`，接收外部 manifest/model 路径；在 `backend: "webgpu"`、`precision: "fp32"` 或 `"fp16"`、`allowFallback: false` 下运行，断言 adapter 存在、runtime.actual backend 与请求一致、检测结果和 CPU 参考一致。

- [ ] **步骤 2：配置工作流标签和条件**

WebGPU job 使用：

```yaml
runs-on: [self-hosted, Windows, X64, webgpu-hardware]
if: github.event_name == 'workflow_dispatch' && vars.RUN_WEBGPU_HARDWARE == 'true'
```

checkout 使用 `lfs: false`，模型通过任务 5 下载器取得；禁止加入 SwiftShader 参数或软件 adapter。

- [ ] **步骤 3：在本机 runner 上运行严格验证**

运行 `PPDETECTION_REAL_MODEL=1` 对 1.0.1 FP32 WASM、FP32 WebGPU、FP16 WebGPU 分别执行七张 fixture；收集浏览器版本、Windows 版本、NVIDIA GPU/驱动、WebGPU adapter features、ORT 版本、manifest revision、模型 SHA-256、Session/逐帧推理耗时和 detection parity。

- [ ] **步骤 4：生成浏览器证据**

只有 adapter、无 fallback、七张 fixture 和严格阈值全部通过，才写入 `webgpu-evidence.json`；任一失败保持 `labs/blocked`，并在报告中记录失败阶段和错误代码。

- [ ] **步骤 5：提交验证证据**

```powershell
git add .github/workflows/ci.yml .github/workflows/benchmark.yml tests/browser/runtime.spec.ts tools/model-pipeline/reports/1.0.1/webgpu-evidence.json docs/zh-CN/compatibility.md docs/en/compatibility.md
git commit -m "接入 NVIDIA WebGPU 验证证据"
```

### 任务 7：模型上传与公共 manifest 发布工作流

**文件：**
- 创建：`.github/workflows/model-distribution.yml`
- 创建：`tools/model-pipeline/picodet/publish_sources.py`
- 创建：`tools/model-pipeline/tests/test_publish_sources.py`
- 修改：`docs/zh-CN/deployment.md`、`docs/en/deployment.md`、`models/pp-detection/1.0.0/README.md`

**接口：**
- 消费：已通过任务 3 和任务 6 的 ONNX、manifest、报告；GitHub Actions secrets `HF_TOKEN`、`MODELSCOPE_TOKEN` 只在运行时注入。
- 产出：Hugging Face 和 ModelScope 公开仓库中的 ONNX、runtime manifest、报告和来源说明；工作流输出 revision，不把 token 写入日志。

- [ ] **步骤 1：写发布脚本测试**

测试发布参数必须包含模型版本、目标仓库、文件清单和 SHA-256；禁止目标仓库为空、文件位于仓库外、重复覆盖已固定 revision 或把 token 拼进 URL/日志。

- [ ] **步骤 2：实现发布脚本**

使用 Hugging Face Hub 和 ModelScope 官方 CLI/API；每个文件先计算 SHA-256，再上传；上传后读取返回的 commit/revision，使用固定 revision URL 回读并校验 bytes/SHA-256。脚本只打印公开 revision、仓库和文件名。

- [ ] **步骤 3：创建手动工作流**

工作流仅 `workflow_dispatch`，输入 `model_version`、`upload_huggingface`、`upload_modelscope`；必须从受保护分支运行，使用最小权限和 secrets，禁止 Git LFS checkout。上传成功后运行外部下载校验，并将 revision 作为 artifact 保存。

- [ ] **步骤 4：运行脚本测试**

运行：`python -m pytest tools/model-pipeline/tests/test_publish_sources.py -q`。

预期：脚本参数、路径安全、覆盖保护和脱敏测试通过；没有真实 token 时不执行上传。

- [ ] **步骤 5：提交发布工作流和文档**

```powershell
git add .github/workflows/model-distribution.yml tools/model-pipeline/picodet/publish_sources.py tools/model-pipeline/tests/test_publish_sources.py docs/zh-CN/deployment.md docs/en/deployment.md models/pp-detection/1.0.0/README.md
git commit -m "增加 Hugging Face 与 ModelScope 模型发布流程"
```

### 任务 8：清单启用、Pages 和 npm 发布前验证

**文件：**
- 修改：`models/pp-detection/1.0.1/manifest.json`
- 修改：`scripts/stage-pages-models.mjs`
- 修改：`scripts/verify-release.mjs`、`scripts/verify-release.test.mjs`
- 修改：`apps/demo/src/model-sources.ts`
- 修改：`README.md`、`README.en.md`、`packages/sdk/README.md`、`CHANGELOG.md`
- 修改：`docs/zh-CN/models.md`、`docs/en/models.md`、`docs/zh-CN/conversion.md`、`docs/en/conversion.md`、`docs/zh-CN/quick-start.md`、`docs/en/quick-start.md`

- [ ] **步骤 1：确认启用前置条件**

逐项确认：Hugging Face 和 ModelScope manifest/ONNX 的固定 revision 可匿名 HTTPS 下载；两份 ONNX bytes/SHA-256 相同；CORS 正常；FP32 WASM、FP32 WebGPU、FP16 WebGPU 报告通过；许可和归属文本已核验。任一项未满足时不修改 manifest 状态。

- [ ] **步骤 2：生成稳定 manifest**

使用 `build_manifest.py` 从 1.0.1 实际文件和来源报告生成；设置来源顺序 Hugging Face、ModelScope、Git LFS，变体 backend/precision 只填写报告实际通过的组合；禁止手工复制 1.0.0 或其他模型哈希。

- [ ] **步骤 3：更新 Pages staging**

Pages 不再把大模型复制到 GitHub Pages；blocked 清单仍只写 manifest，stable 清单只保留公开来源 URL。脚本验证 Hugging Face 默认来源的 bytes/SHA-256，并在来源失败时显示错误而不换源。

- [ ] **步骤 4：运行完整验证**

运行：`pnpm format:check`、`pnpm docs:test`、`pnpm release:test`、`pnpm benchmark:test`、`pnpm benchmark:parity`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm sdk:check -- --repo ..\\web-sdk-PP-Detection --format table`。

预期：所有本地检查通过；远程 WebGPU job 必须在真实 NVIDIA runner 上通过后才可合并启用提交。

- [ ] **步骤 5：提交稳定清单启用**

```powershell
git add models/pp-detection/1.0.1/manifest.json scripts/stage-pages-models.mjs scripts/verify-release.mjs scripts/verify-release.test.mjs apps/demo/src/model-sources.ts README.md README.en.md packages/sdk/README.md CHANGELOG.md docs models/pp-detection/1.0.1
git commit -m "启用 Hugging Face 默认模型清单"
```

### 任务 9：安全复核、PR 和线上验收

**文件：**
- 检查：全部任务变更、GitHub Actions secrets/variables、公开 Hugging Face/ModelScope 页面和 Demo。
- 修改：仅在复核发现实际问题时修改对应文件，不重写历史报告。

- [ ] **步骤 1：执行密钥与路径扫描**

运行：`git grep -n -i -E 'ms-[a-z0-9-]{20,}|hf_[a-z0-9]+|Authorization:|Bearer |NPM_TOKEN|NODE_AUTH_TOKEN' -- ':!pnpm-lock.yaml'`；预期无结果。运行 `git diff --check`，预期无空白错误。

- [ ] **步骤 2：检查外部来源**

匿名请求 Hugging Face 和 ModelScope 固定 revision manifest/ONNX，记录 HTTP 状态、Content-Length、CORS、bytes 和 SHA-256；不把 token 放入 URL。

- [ ] **步骤 3：检查 Demo**

在桌面和 390px 视口打开 Pages Demo，分别验证 Hugging Face 默认、ModelScope 切换、自定义 manifest、图片、视频、摄像头、CPU/WASM、GPU/WebGPU、缓存清理和耗时信息；确认错误不会显示私密参数。

- [ ] **步骤 4：创建 PR 并等待检查**

每个独立任务提交后推送 `codex/` 分支；PR 描述列出模型 revision、哈希、浏览器/runner 证据和限制。CI 若再次在 checkout 阶段报告 LFS 配额，确认对应工作流已设置 `lfs: false` 后再处理实际失败，不通过重试掩盖问题。

- [ ] **步骤 5：模型和 npm 发布**

模型公共来源和证据合并后，先在 Hugging Face/ModelScope 保留不可变 revision；确认线上 Demo 可取模型后，再按现有 Trusted Publishing 工作流准备 npm 版本、provenance 和线上 smoke。ONNX 不进入 npm tarball。

## 计划自审

- 规格中的来源角色、固定 revision、显式不换源、Demo 默认、媒体输入、实际来源回传、CI 脱离 LFS、真实 NVIDIA runner、模型证据、分发工作流、文档和 npm 阶段均有对应任务。
- 没有未完成标记或未定义的函数名称；动态模型 revision 只在上传后从平台响应读取，不在计划中臆造。
- 任务 1 产出的 `PPDetectionModelSourceInfo`、任务 2 的 source order、任务 5 的下载器环境变量和任务 6 的 runner 标签在后续任务中保持一致。
- 任何稳定启用都位于任务 8，并受任务 3、6、7 的真实证据约束；当前 `labs/blocked` 状态不会因文档或来源上传单独改变。
