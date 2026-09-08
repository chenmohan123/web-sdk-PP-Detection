# 开发依赖兼容升级验收

核验日期：2026-09-08（Asia/Shanghai）。基线为已合并 fast-uri 安全补丁的 `f21dc038db2ccfd59668b181de6999a181c261c0`，分支为 `codex/dependencies-compatible-upgrade`，属于单 SDK 开发工具、Demo 和示例依赖维护。

## 升级范围与保留项

本轮从 Dependabot PR #27 提取 15 项兼容升级：

| 依赖                     | 原锁定版本 | 当前锁定版本 |
| ------------------------ | ---------- | ------------ |
| @eslint/js               | 9.39.5     | 10.0.1       |
| eslint                   | 9.39.5     | 10.10.0      |
| playwright               | 1.62.1     | 1.63.0       |
| typescript-eslint        | 8.66.0     | 8.69.0       |
| vitest                   | 3.2.7      | 5.0.0        |
| @vitejs/plugin-react     | 5.0.4      | 6.1.1        |
| react / react-dom        | 19.1.0     | 19.2.8       |
| @types/react             | 19.1.10    | 19.2.18      |
| @types/react-dom         | 19.1.7     | 19.2.7       |
| vite                     | 7.3.6      | 8.2.2        |
| @microsoft/api-extractor | 7.58.12    | 7.59.0       |
| @vitejs/plugin-vue       | 6.0.1      | 6.0.8        |
| vue                      | 3.5.21     | 3.5.42       |
| vue-tsc                  | 3.0.8      | 3.3.11       |

以下 4 项继续采用原有版本：

- TypeScript 5.9.3，根范围仍为 `^5.9.0`。原 PR 的 [CI 34194387025](https://github.com/chenmohan123/web-sdk-PP-Detection/actions/runs/34194387025/job/101958842530) 在 `scripts/check-doc-parity.mjs:63` 的 `ts.ModuleKind.ESNext` 失败。官方 `typescript@7.0.2` 默认导出为 `./lib/version.cjs`，不提供当前脚本所用的旧编译器 API；`typescript-eslint@8.69.0` 及 parser 的支持范围为 `>=4.8.4 <6.1.0`。保留既有文档严格编译与类型驱动 lint。
- ONNX Runtime Web 1.27.0。1.29.0 涉及推理运行时，需独立模型与后端验证，不纳入此次开发工具维护。
- `@types/node` 24.13.3，根范围仍为 `^24.0.0`，与 `.nvmrc` 的 Node 24 保持一致。
- Lucide React 0.468.0。Detection 的 `apps/demo/src/App.tsx` 使用 `Github` 图标；只读导入官方 1.41.0 包确认 `Github` 为 `undefined`，而 `Download`、`FileImage` 仍存在。本轮保留现有图标接口。

修改 8 份 `package.json`、pnpm 生成的锁文件，并修复一项 Demo 摄像头测试夹具。SDK 0.2.0、示例固定公开 SDK 0.2.0、模型、运行时及 Demo 产品源码均未改变。

## 已完成验证

- `pnpm install --lockfile-only --ignore-scripts --cache-dir .tmp/pnpm-cache --config.state-dir=.tmp/pnpm-state` 成功生成清单一致的锁文件；主线程随后执行 `pnpm install --frozen-lockfile --store-dir F:/.pnpm-store --config.confirmModulesPurge=false` 成功，339 个条目通过供应链检查。
- 前后 `pnpm sdk:check -- --repo F:/git/00_chenmohan/github/web-sdk-PP-Detection` 均为 required 18 通过、0 失败、4 远程跳过。证据见 [before](2026-09-08-dependencies-compatible-standard-before.json)、[after](2026-09-08-dependencies-compatible-standard-after.json)，其中保留规则 ID、证据路径和修复建议。
- `pnpm audit --json`：339 项依赖，info、low、moderate、high、critical 均为 0。分别从 Ajv 8.18.0、8.20.0 的实际包位置解析 fast-uri，均为 3.1.6。
- `pnpm docs:test`：5 项通过，继续严格编译全部双语 TypeScript 文档示例。
- `pnpm examples:check`、`pnpm release:test`、`pnpm benchmark:test`：分别为 10、20、6 项通过。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`：通过，包含 SDK 与 Demo 的类型驱动 ESLint 10，以及 SDK 的 ESM、Worker、全局入口和声明构建。
- `pnpm --filter web-sdk-pp-detection test`：Vitest 5 下 19 个文件、132 项测试通过。
- `pnpm --filter @ppdetection/demo typecheck`、`pnpm --filter @ppdetection/examples-tests typecheck`：通过。
- `pnpm --filter './examples/*' --if-present build`：React、Vue、Vanilla Vite、微信 web-view 的四份工作区示例全部通过自身类型检查和 Vite 8 构建，消费固定公开 SDK 0.2.0。
- `pnpm --filter @ppdetection/demo build`：通过。
- `node apps/demo/node_modules/vite/bin/vite.js build apps/demo --base /web-sdk-PP-Detection/` 和 `node scripts/stage-pages-models.mjs`：通过，覆盖 Pages 子路径生产构建和模型暂存。
- `node node_modules/playwright/cli.js test tests/browser/benchmark-parity.spec.ts --output .tmp/dependencies-compatible-parity`：14 项通过。
- `node node_modules/playwright/cli.js test tests/browser/runtime.spec.ts --grep "browser WASM" --output .tmp/dependencies-compatible-runtime`：1 项通过。
- `pnpm --filter @ppdetection/examples-tests test`：宿主可写缓存下 14 项全部通过，退出码为 0；此前 5 项独立安装失败由临时缓存写入 `ERR_PNPM_EPERM` 导致。
- `pnpm exec playwright test tests/browser/package.spec.ts`：4 项通过。
- `pnpm --filter @ppdetection/demo test`：35 项通过且正常退出，覆盖模型资源加载、取消、缓存、视频帧调度、桌面和手机布局。
- `pnpm examples:smoke`：12 项通过且正常退出；React、Vue、Vanilla Vite、微信 web-view、Vanilla 和 CDN 六入口使用固定公开 SDK 0.2.0 与官方 PicoDet 模型字节完成 WASM 推理，均检出 12 个目标，取消与重复操作断言通过。

## 摄像头测试漏报修复

原“图片、摄像头和视频输入场景均可切换”用例以普通对象模拟 `MediaStream`。浏览器将该对象赋给 `video.srcObject` 时抛出 `TypeError`，但旧用例只断言 `getUserMedia` 调用参数，仍会通过。

先加入视频元素可见和页面无未处理错误的断言，保留旧夹具重跑，确认用例失败。再以 `canvas.captureStream(1)` 创建原生 `MediaStream`，仅覆写轨道的 `getSettings` 返回固定设备 ID。修复后单项用例通过，Demo 类型检查、lint 和该测试文件格式检查通过。这一改动使摄像头预览初始化失败能够被测试捕获，不修改实际摄像头逻辑。

## 环境限制

- 本地 `pnpm run verify` 仍在 Prettier 扫描既有忽略目录 `work/pytest-task2` 时返回 `EPERM`。已逐项完成其余组成命令和按已跟踪文件执行的格式检查；不将这些结果表述为完整串联 `verify` 通过。远程 CI 的原始 `pnpm run verify` 是合并前门槛。
- 本地验证使用工作区内 `PWTEST_CACHE_DIR`、`PLAYWRIGHT_BROWSERS_PATH` 以及可写宿主 pnpm 缓存，避免旧临时目录权限影响消费者安装与浏览器退出。

环境为 Windows 10.0.26200、Node 24.16.0、pnpm 11.16.0、Playwright 1.63.0、Chromium 153.0.8010.12、ONNX Runtime Web 1.27.0。原始日志、诊断消费者和下载浏览器仅用于本地验证，不提交。当前报告不声明远程 CI、main 合并或 Pages 部署完成，也不新增物理 GPU、移动端或微信宿主兼容结论。
