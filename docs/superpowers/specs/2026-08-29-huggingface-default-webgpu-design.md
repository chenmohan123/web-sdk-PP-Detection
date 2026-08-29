# Hugging Face 默认分发与真实 WebGPU 验证设计

## 1. 背景与目标

当前仓库已经为 PicoDet-L-320 本地 FP32 候选记录了 Git LFS、Hugging Face 和
ModelScope 的候选副本，但默认 manifest 仍为 `labs/blocked`。Demo 中 Hugging
Face 和 ModelScope 选项也仍被禁用，普通 CI 因 checkout Git LFS 超出配额而在
测试前失败。用户提供的 `windows-nvidia-webgpu` runner 已在线，但目前注册在
`web-sdk-PP-DocLayoutV3` 仓库，不能被本仓库的工作流调度。

本设计的目标是：

- 让 Hugging Face 成为 Demo 的默认模型分发来源；
- 让 ModelScope 成为可选的国内镜像，并保留 Git LFS 作为可选来源和审计证据；
- 让 SDK 使用 manifest 中的不可变 revision、字节数和 SHA-256 选择并校验来源；
- 使用真实 NVIDIA WebGPU runner 生成可复现的 WebGPU 证据；
- 保持 CPU/WASM、WebGPU、精度和来源的显式选择语义，不静默替换用户请求；
- 在模型证据满足前继续显示 `labs/blocked`，不提前宣称 stable 或修改默认发布状态。

## 2. 范围和非目标

### 范围

- `packages/sdk` 的来源选择、实际来源回传和错误/缓存行为；
- `apps/demo` 的 Hugging Face 默认选择、ModelScope/Git LFS/自定义清单入口和来源信息；
- PicoDet 模型清单、模型上传脚本、来源证据和模型版本化发布流程；
- CI、模型验证和物理 WebGPU 工作流；
- 中英文 README、API、模型、转换、部署和性能文档；
- 覆盖来源选择、CORS、完整性、WASM 和真实 WebGPU 的测试。

### 非目标

- 不在 SDK runtime 中引入 React、Vue 或其他 UI 框架；
- 不把 ModelScope token、GitHub token 或任何私密 URL 写入代码、manifest、日志或报告；
- 不删除历史 `1.0.0` 模型资产，不复用其他模型的 SHA-256 或验证报告；
- 不在没有真实硬件证据时把 WebGPU、移动端、微信 WebView 或 FP16/INT8/INT4/FP8
  标记为 stable；
- 不要求 GitHub LFS 继续承担 Demo 的默认模型分发。

## 3. 分发模型

### 3.1 来源角色

每个可发布变体在 runtime manifest 的 `sources[]` 中记录三类公共来源：

| 来源 | 用途 | 默认级别 | 要求 |
| --- | --- | --- | --- |
| Hugging Face | Demo 默认下载和国际公共分发 | Demo 默认、`auto` 首选 | 固定 commit revision、公开 HTTPS URL、CORS、字节数和 SHA-256 |
| ModelScope | 国内镜像和手动切换 | 显式选择或 `auto` 备用 | 固定 revision、公开 HTTPS URL、CORS、字节数和 SHA-256 |
| Git LFS | 仓库审计、开发者可选来源 | 不作为 Demo 默认 | 只接受已拉取的模型本体；pointer 不得作为浏览器资产 |

Hugging Face 和 ModelScope 仓库同时保存 ONNX 文件、runtime manifest 和来源说明。
manifest 中的来源 `revision` 必须是不可变的 40 至 64 位十六进制提交；下载 URL
必须直接指向该 revision 下的文件，不能使用移动的 `main`、`master` 或 latest URL。
模型本体、manifest 和来源报告的 revision 分别记录，不能只记录仓库首页地址。

`auto` 的顺序由生成的 manifest 固定为 Hugging Face、ModelScope、Git LFS；显式
`source: "huggingface"`、`"modelscope"` 或 `"git-lfs"` 只尝试对应来源，失败时
返回 `MODEL_SOURCE_UNAVAILABLE` 或 `MODEL_INTEGRITY_FAILED`，不静默切换。自定义
manifest 仍可使用 `custom` 来源，但必须满足同一完整性规则。

### 3.2 Demo 入口

Demo 的 `modelSource` 初始值改为 `huggingface`。来源选择器展示 Hugging Face、
ModelScope、Git LFS（仅当浏览器可访问有效模型 URL 时启用）和自定义 manifest；
`SDK 默认` 只作为兼容别名，不再优先于 Hugging Face。选择来源时：

1. 使用来源对应的不可变 runtime manifest URL；
2. 初始化 SDK 时传入同一个来源选择；
3. 在模型信息区显示请求来源、实际来源、revision、文件大小、参数量和 SHA-256；
4. 来源切换会释放现有 detector、停止视频/摄像头调度并清空当前结果，但不清理全局缓存；
5. 清单处于 `labs/blocked` 或来源未满足 CORS/完整性条件时，显示阻塞原因并保留自定义清单入口。

Demo 仍支持图片、视频和摄像头。视频/摄像头持续帧沿用当前 scheduler；模型只在
首次运行时加载并缓存，来源切换或缓存清理后重新记录下载、完整性、Session、推理、
后处理和总耗时。自动模式显示 requested/actual backend、precision、source 和 fallback 历史。

## 4. SDK 接口和数据流

### 4.1 Manifest 与来源

保持现有 `ModelSourceKind` 和 `CreatePPDetectionOptions.source` API。runtime
manifest 的变体来源顺序必须与生成规则一致，`ModelManager` 继续按显式来源或
`auto` 解析、缓存和校验。为支持 Demo 展示实际来源，在公开模型信息中增加只读的
来源摘要：`kind`、`revision`、`bytes` 和 `sha256`；不暴露带查询参数的私有 URL。

调用链为：

```text
Demo 来源选择
  -> 获取不可变 runtime manifest
  -> createPPDetection({ model: manifestUrl, source, backend, precision })
  -> parse/adapt manifest
  -> 选择变体和来源
  -> cache lookup(source revision + sha256)
  -> fetch + Content-Length/Range 校验
  -> SHA-256 校验
  -> ORT Session（WASM 或 WebGPU）
  -> result.model/runtime/timings 回传实际来源和后端
```

来源选择不改变后端选择。后端选择仍支持 `wasm`、`webgpu`、`auto`；精度仍支持
`fp32`、`fp16`、`int8`、`int4`、`fp8`。显式 WebGPU 或精度请求保持严格，只有
`allowFallback: true` 且请求为自动策略时才记录 fallback 并切换。

### 4.2 错误和隐私

- manifest HTTP、JSON 或 schema 错误：`MODEL_SOURCE_UNAVAILABLE` 或 `INVALID_MANIFEST`；
- CORS、非 2xx、Content-Length、Range、大小或 SHA-256 错误：保留来源 kind 和
  错误阶段，返回 `MODEL_DOWNLOAD_FAILED` 或 `MODEL_INTEGRITY_FAILED`；
- 用户取消、页面卸载或切换来源：返回 `ABORTED`，停止媒体和 worker/GPU 引用；
- 任何错误详情不得包含 token、Authorization header、完整查询参数或本地绝对路径；
- 报告只记录公开 revision、SHA-256、能力探测、浏览器/系统、适配器信息和耗时。

## 5. 模型版本和证据门槛

当前 `1.0.0` 候选与官方 Bcebos 文件字节不同，不能直接作为官方 stable 资产。
先创建独立的 PicoDet 模型版本（建议 `1.0.1`）：

- 生成不含 DOUBLE 执行路径的 FP32 ONNX；
- 保留并独立验证 FP16 资产；
- 对每个变体生成结构、CPU parity、WASM、物理 WebGPU、大小和 SHA-256 报告；
- 将 ONNX、runtime manifest 和报告分别上传 Hugging Face、ModelScope，并记录固定 revision；
- Git LFS 只作为可选镜像，不能用 pointer 文件生成浏览器证据；
- 只有来源、许可、WASM、WebGPU 和跨输入场景证据全部满足时，manifest 才可从
  `labs/blocked` 生成 `stable` 变体。

FP32 清理转换必须失败关闭：只接受已知 DOUBLE 初始化器/拓扑，转换前后运行 ONNX
checker 和 shape inference，并以现有严格 FP32 检测阈值验证七张 fixture。FP16、INT8、
INT4、FP8 必须分别记录真实文件和报告，不能从 FP32 报告推断。

## 6. GitHub Actions 与真实 NVIDIA runner

### 6.1 Runner 前置条件

`windows-nvidia-webgpu` 当前在线但注册在 DocLayoutV3。要让 Detection 调度它，
需要将同一 runner 重新注册到 Detection 仓库，或注册到同时授权两个仓库的组织级
runner，并保留标签：`self-hosted`、`Windows`、`X64`、`webgpu-hardware`。
这是 GitHub 设置变更，不由代码自动完成。

Detection 仓库需要新增/确认 Actions 变量 `RUN_WEBGPU_HARDWARE=true`。工作流只在
该变量为 true 且为手动运行时调度物理 runner，不使用 SwiftShader 或其他软件适配器。

### 6.2 工作流分工

- 普通 CI：`actions/checkout` 使用 `lfs: false`，因为当前 `labs/blocked` 模型测试
  不需要模型本体；继续运行完整 SDK、Demo、包 smoke、文档和构建测试，避免 LFS 配额
  在 checkout 阶段阻塞反馈。
- 模型验证：从 Hugging Face 固定 revision 下载 manifest/ONNX，必要时从 ModelScope
  固定 revision 做镜像一致性校验；验证 URL、字节数、SHA-256 和报告，不依赖 GitHub LFS。
- 物理 WebGPU：使用 `runs-on: [self-hosted, Windows, X64, webgpu-hardware]`，
  `lfs: false`，下载待验模型后运行严格 `backend: webgpu`、`allowFallback: false`
  的 FP32/FP16 测试，记录 GPU adapter、驱动、浏览器、ORT、Session 和逐 fixture 耗时。
- Pages：Demo 直接使用已发布的 Hugging Face runtime manifest；Pages 只构建 Demo
  和必要的静态元数据，不复制大模型到 GitHub Pages，也不把 blocked 清单下载到网络。
- npm release：只发布 SDK runtime 和文档，不把 ONNX 放入 npm tarball；发布前检查默认
  manifest 的公开 URL 可访问且 SHA-256 与报告一致。

## 7. 测试策略

### SDK

- 解析三类 source，验证 `auto` 顺序和显式来源不换源；
- 验证来源 revision + SHA-256 组成缓存 key，来源切换不会复用错误副本；
- 模拟 HTTP、CORS、Content-Length、Range、摘要和 Abort 错误；
- 检查结果公开模型信息包含实际来源且不包含 token/查询参数。

### Demo

- 默认来源为 Hugging Face，ModelScope 可切换，自定义 manifest 可用；
- 选择来源会释放 detector、停止媒体调度并保留全局缓存；
- 图片、视频、摄像头分别覆盖；
- CPU/WASM 与 GPU/WebGPU 的加载、推理、后处理和总耗时标记存在；
- blocked/来源错误状态不渲染破损预览，390px 视口不溢出。

### 模型与浏览器

- 结构检查和七张 fixture 的 CPU parity；
- Headless Chromium WASM smoke 作为基线；
- 真实 NVIDIA runner 上的 FP32/FP16 WebGPU 严格验证；
- Hugging Face 与 ModelScope 相同文件的字节、SHA-256 和 runtime 结果一致；
- CORS、移动端和微信 WebView 只能在实际环境验证后写入兼容矩阵。

## 8. 交付阶段

### 阶段一：来源和验证基础

完成 source 配置、SDK 实际来源回传、Demo Hugging Face 默认、普通 CI 脱离 LFS、
外部下载验证和物理 runner 工作流。此阶段不改变 `labs/blocked`。

### 阶段二：模型资产发布

生成并验证版本化 FP32/FP16 资产，上传 Hugging Face 和 ModelScope，固定 revision，
生成 manifest 与报告；模型验证工作流全部通过后，再创建外部模型的公开版本记录。

### 阶段三：默认模型启用

确认 Hugging Face manifest 和 ONNX 在浏览器环境公开可取、CORS 正常且 SHA-256 一致，
再启用 Demo 默认模型和稳定变体。更新中英文文档、兼容矩阵、Pages 和 release notes。

### 阶段四：npm 发布

模型来源稳定后再准备 SDK 版本发布，运行 Trusted Publishing、包 smoke、provenance
和线上 Demo 验证。模型文件不进入 npm 包。

## 9. 验收标准

- Demo 默认请求 Hugging Face 固定 revision，ModelScope 可显式选择，Git LFS 不再是默认来源；
- SDK 显式来源失败不静默换源，自动来源顺序和实际来源可观察；
- 普通 CI 不因 Git LFS 配额失败，模型验证和 WebGPU 验证不依赖 GitHub LFS；
- Detection 的物理 WebGPU 工作流能在带 `webgpu-hardware` 标签的 NVIDIA runner 上执行；
- 每个发布变体有独立模型字节、revision、大小、SHA-256、许可、WASM 和 WebGPU 证据；
- 图片、视频、摄像头和 CPU/GPU 耗时展示继续通过 Demo 契约测试；
- 在证据不完整时，所有用户可见文档和 manifest 仍明确显示 `labs/blocked`；
- 不提交 token、私有 URL、历史资产变更或未授权的 GitHub 设置变更。
