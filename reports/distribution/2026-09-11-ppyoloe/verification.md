# 本轮验证记录

> 后续状态：2026-09-12 用户确认 PP-YOLOE 转为 0.1.0 stable，见[稳定记录](../../stability/2026-09-12-ppyoloe/README.md)。本文记录此前 labs 分发与验证；当时本地 manifest 和模型卡的原始字节已保存到[历史快照](../../stability/2026-09-12-ppyoloe/previous/)。

日期：2026-09-11；ModelScope 补充记录更新于 2026-09-12（Asia/Shanghai）。所有命令在本地工作树执行，没有 npm 发布、GitHub 推送或 Pages 部署。

## 模型分发

模型 Hub 的固定提交、bytes、SHA-256 及清单对应关系见 [hub-verification.json](hub-verification.json)。独立审查再次读取公开提交与固定下载，确认两阶段提交只新增候选目录，稳定 PicoDet 根目录文件对象未变化；许可与固定上游 Apache-2.0 文件一致。

### ModelScope 补充分发

用户提供临时令牌并授权补充分发后，通过客户端实例直接传入令牌执行两阶段上传，未调用登录命令或持久保存令牌。两次上传仅涉及 `ppyoloe-plus-s-640/0.1.0-labs.1/`：第一阶段上传模型、许可与模型卡，第二阶段上传包含两个固定来源的清单。上传前后原有路径的大小、对象身份和哈希均一致，见 [modelscope-model-upload.json](modelscope-model-upload.json)、[modelscope-manifest-upload.json](modelscope-manifest-upload.json)。

模型固定提交为 `af865f1c515634de08fe0fc5eeeac8942456241c`，回下载 31,954,220 bytes，SHA-256 为 `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c`，HTTP 200、CORS `*`。双来源清单固定提交为 `9f3f052a30bb8560aaabe204a84d5e51cf989079`，回下载 4,275 bytes，SHA-256 为 `e6ac38bfb8039f1b518e345e791db7a9261d472624b99bbf0c77bf72f431a411`，HTTP 200，与本地清单逐字节一致，SDK 解析通过。证据见 [modelscope-verification.json](modelscope-verification.json)。

Hugging Face 远端初始清单、上传与浏览器记录仍是 2026-09-11 的单来源快照；没有改写旧记录。当前 Demo 构建包含本地双来源清单；ModelScope 上的固定清单是该版本的公开副本。

## 已完成的基础检查

| 检查           | 命令                                                                                  | 结果                            |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| SDK 单元测试   | `pnpm test`                                                                           | 19 个文件、136 项通过           |
| SDK 类型检查   | `pnpm typecheck`                                                                      | 通过                            |
| SDK 构建       | `pnpm build`                                                                          | ESM、IIFE、Worker、声明文件通过 |
| 文档           | `pnpm docs:test`                                                                      | 5 项通过                        |
| 示例契约       | `pnpm examples:check`                                                                 | 10 项通过                       |
| 发布契约       | `pnpm release:test`                                                                   | 20 项通过                       |
| 基准契约       | `pnpm benchmark:test`                                                                 | 6 项通过                        |
| 清单与来源专项 | `pnpm --filter web-sdk-pp-detection test -- manifest.test.ts source-resolver.test.ts` | 26 项通过                       |

`pnpm test:browser` 首轮 31 项通过、5 项有条件跳过；旧示例的 `beforeAll` 在 `pnpm install` 阶段失败，随后 11 项未运行。确认 `.tmp/examples-runtime/` 已有公开 npm `0.2.0` 依赖后，使用现有复用开关单独完成原样示例测试：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path .tmp/dependencies-compatible-browsers).Path
$env:PPDETECTION_EXAMPLES_REUSE = "1"
node node_modules/playwright/cli.js test tests/browser/examples-runtime.spec.ts
```

补跑的 12 项全部通过，包含六种示例的重复点击/取消和真实 PicoDet 推理。测试按既有隔离策略使用公开 npm SDK 原包与本地官方模型字节，不代表外部 CDN 网络连通性。5 项跳过来自需要专门配置的真实模型基准与默认 headless WebGPU 无适配器；候选的真实 WebGPU 另由 `channel: chromium` 的 Demo 验收记录。

## Demo 最终检查

Demo 最终 67 项浏览器测试全部通过，包括模型切换 6 项；类型检查、lint 通过。为避免与实现代理使用的 4174 端口冲突，主代理复用同一 Vite 配置在 4175 提供页面，只在临时 Playwright 配置中修改 baseURL 并关闭重复启动服务器。

```powershell
pnpm --filter @ppdetection/demo typecheck
pnpm --filter @ppdetection/demo lint
node node_modules/playwright/cli.js test --config .tmp/ppyoloe-demo-existing.config.ts
pnpm --filter @ppdetection/demo build --outDir ../../.tmp/ppyoloe-distribution-demo-build --base /web-sdk-PP-Detection/
```

默认 `apps/demo/dist/assets` 存在历史权限限制，默认构建在准备输出目录时返回 EPERM；改用新的 `.tmp/ppyoloe-distribution-demo-build` 后生产构建成功。没有修改编译配置或删除旧输出目录。最终实际浏览器验收由 Vite preview 在 4176 提供该生产构建，并完成 5 次推理和窄屏布局验证。

## 浏览器实际验收

原始结果见 [desktop-browser.json](desktop-browser.json)，测试脚本见 [verify-demo.mjs](verify-demo.mjs)。使用 Windows 11、Chromium 153.0.8010.12、ORT Web 1.27.0，物理 GPU 适配器 vendor=`nvidia`、architecture=`blackwell`、isFallbackAdapter=`false`；浏览器隐藏 device/description 字段，以 null 记录。

本验收从固定 Hugging Face URL 下载模型，在真实 Demo 点击检测后导出 SDK JSON；显式 WASM/WebGPU 后端要求实际一致且没有回退。首张检测包含后端首次编译和懒初始化，因此此处是功能验收，不能将单张耗时与上一阶段 64 图热运行指标直接比较。

页面原始 console 信息随报告保留，包括 ORT 清理未使用 initializer、部分 shape 节点分配到 CPU 和 Windows powerPreference 提示；它们不同于 SDK 后端 fallback。未处理页面异常单独记录在 `pageErrors`。

浏览器自动请求的 `/favicon.ico` 返回 404，模型与 ORT 资源未失败；该非业务资源情况也保留在原始 console 信息中。检测图片、JSON 导出与模型切换均通过。由于本轮是功能验收且可能与回归测试同时运行，耗时不作为性能基准。

### 2026-09-12 ModelScope 验收

双来源清单构建成功后，在 4176 的生产预览执行实际推理。最初两次连续验收均完成 3 次 WASM 检测，随后在重复冷下载 PicoDet 时等待 120 秒超时；第二次诊断截图显示“模型下载中 37%”，尚未进入 GPU Session。原始失败记录见 [首次验收](modelscope-browser/desktop-browser.json)、[带诊断的复现](modelscope-browser-retry/desktop-browser.json)与[页面截图](modelscope-browser-retry/failure.png)。请求记录省略 CDN 临时查询参数。

随后将 WASM 与 WebGPU 分别放在独立浏览器会话中执行，继续从真实 ModelScope 固定地址冷下载，不拦截请求或注入模型。没有修改 SDK 下载或推理逻辑，也没有增加静默重试、换源或后端回退。

| 来源与后端          | 检测                                          | 结果                                                       |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| ModelScope / WASM   | PicoDet 冷加载、PP-YOLOE 冷加载及持久缓存复用 | [3 次通过](modelscope-browser-wasm/desktop-browser.json)   |
| ModelScope / WebGPU | PicoDet、PP-YOLOE 冷加载                      | [2 次通过](modelscope-browser-webgpu/desktop-browser.json) |

两份成功记录中的实际来源为 `modelscope`，实际后端与显式选择一致，fallbacks 和 pageErrors 均为空；390px 的 `scrollWidth=clientWidth=390`。浏览器为 Chromium 153.0.8010.12，WebGPU 适配器为 NVIDIA Blackwell、`isFallbackAdapter=false`。PP-YOLOE 导出 JSON 的版本、模型字节数与 SHA-256 均与分发清单一致。此结果证明本次本机功能验收通过，不代表连续冷下载永不超时，也不作为移动端或稳定网络吞吐量承诺。

复现命令如下；每个命令使用独立浏览器会话：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path .tmp/dependencies-compatible-browsers).Path
$env:PPDETECTION_DEMO_URL = "http://127.0.0.1:4176/web-sdk-PP-Detection/"
$env:PPDETECTION_DEMO_SOURCE = "modelscope"
$env:PPDETECTION_DEMO_BACKENDS = "webgpu"
$env:PPDETECTION_REPORT_DIRECTORY = "reports/distribution/2026-09-11-ppyoloe/modelscope-browser-webgpu"
node reports/distribution/2026-09-11-ppyoloe/verify-demo.mjs
$env:PPDETECTION_DEMO_BACKENDS = "wasm"
$env:PPDETECTION_REPORT_DIRECTORY = "reports/distribution/2026-09-11-ppyoloe/modelscope-browser-wasm"
node reports/distribution/2026-09-11-ppyoloe/verify-demo.mjs
```

本次还重新执行清单与来源测试（26 项）、Demo 模型选择测试（6 项）和 Demo 类型检查，均通过；双来源下显式来源失败测试确认只请求选定来源。原始 Playwright 配置因 4174 已有服务而拒绝重复启动，改用已有 4175 服务与既有临时配置后完成全部 6 项。双来源 Demo 生产构建通过；本节之前的全量测试记录属于 2026-09-11 的上一阶段快照。

收尾检查：文档契约 5 项通过；Git 可见文件格式检查 263 项通过；验收脚本语法与 `git diff --check` 通过。最终治理结果见 [modelscope-standard-after.json](modelscope-standard-after.json)：`locally-compliant`，required 通过 18、失败 0、远程规则跳过 4。两份成功浏览器报告的 14 项文件摘要与最终文件一致；模型、模型卡、许可和清单仍与上传记录一致，见 [modelscope-final-checks.json](modelscope-final-checks.json)。工作区文本及本轮临时脚本共 440 个文件未发现 ModelScope 令牌格式，门户工作树无变更。

## 移动端

2026-09-11 先交付小米 15 操作清单；2026-09-12 用户通过局域网 HTTPS 反馈 CPU/GPU 测试正常，并提供真实摄像头截图。截图确认 Android Edge（UA `EdgA/152.0.0.0`）运行 PP-YOLOE 的 ModelScope 固定版本，实际 `webgpu` / `fp32` / `main`，ORT 1.27.0。页面显示单帧推理 133 ms、端到端 201 ms、初始化 5,210 ms，这些是动态页面显示快照，不是连续帧基准。

状态更新为基础功能人工验证通过；原图和来源区分见 [实测记录](mobile-xiaomi15-2026-09-12/README.md)，其余项目见 [mobile-validation.md](mobile-validation.md)。CPU 结论来自用户反馈；未补造 CPU 耗时、完整回退列表、真实 Android/HyperOS 版本或其他浏览器证据。

## 环境与格式边界

历史 `work/pytest-task2-review` 和 `.pytest_cache` 含当前账户无法遍历的目录，整目录 Prettier 会报 EPERM。使用 Git 可见文件列表、原有 `.prettierignore` 与相同 Prettier 配置逐文件检查，避免扫描不可读的历史临时目录。

机器评测/分发 JSON、已上传的模型卡和模型 manifest 保留生成或上传时字节；模型卡换行与上传清单 SHA-256 对齐，因此不重新格式化。没有删除历史缓存目录或改写既有评测证据。
