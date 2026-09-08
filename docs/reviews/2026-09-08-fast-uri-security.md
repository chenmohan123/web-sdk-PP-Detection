# fast-uri 3.1.6 安全补丁验收

核验日期：2026-09-08（Asia/Shanghai）。基线为 `bd53a04ac396400e8c85ed409699fe77f3c4c644`，属于单 SDK 开发依赖维护。

锁文件将 fast-uri 从 3.1.5 更新到 3.1.6，共替换 5 行：包索引、官方 SHA-512 完整性值、两条 Ajv 依赖引用和快照索引。两个 Ajv 版本仍为 8.18.0、8.20.0；其他依赖解析、包声明、SDK 0.2.0、运行时源码、模型及示例固定 SDK 版本保持原值。

3.1.6 的官方完整性值经 `pnpm view fast-uri@3.1.6 dist.integrity --json` 核对为 `sha512-7Ical1vFEMr0onbVzEDIreM22I4khW+fzyQPwvAFWBp1iwdshSZRsL4jjRvPG9JP1uiqMHRto+YU6R2/CzDz5Q==`。`pnpm install --frozen-lockfile` 成功，未重新解析依赖，373 个锁定条目通过 pnpm 供应链策略检查。

## 验证结果

- 修改前后门户标准检查均为 required 18 通过、0 失败、4 远程跳过，recommended 0 失败。详见 [修改前](2026-09-08-fast-uri-security-standard-before.json)、[修改后](2026-09-08-fast-uri-security-standard-after.json)，其中保留规则 ID、证据路径和修复建议。
- `pnpm why fast-uri --recursive` 仅返回 3.1.6，路径来自开发工具 tsup / API Extractor 下的 Ajv。分别从 Ajv 8.18.0 和 8.20.0 的包位置调用 Node `createRequire().resolve("fast-uri/package.json")`，实际安装包均为 3.1.6。
- `pnpm audit --json` 返回 0 条漏洞：info、low、moderate、high、critical 均为 0；共审计 373 项依赖，其中开发依赖 219 项、普通依赖 101 项、可选依赖 54 项。原始输出保留在本地忽略目录 `.tmp/fast-uri-security-audit-after.json`，不提交。
- `pnpm run verify` 全部通过：文档契约 5 项、示例契约 10 项、发布与仓库契约 20 项、基准契约 6 项、基准 parity 14 项、SDK 单元测试 132 项，以及格式、lint、类型检查和 SDK 构建。文档中的 TypeScript 示例仍执行严格编译检查。
- `pnpm exec playwright test tests/browser/runtime.spec.ts --grep "browser WASM"`：1 项通过，验证微型 ONNX 模型的确定性 WASM 生命周期。
- `pnpm exec playwright test tests/browser/package.spec.ts`：4 项通过，覆盖独立 Vite 消费者类型与构建、全局入口和 Worker 推理、包入口、模型文件排除。
- `pnpm --filter @ppdetection/demo exec vite build --base /web-sdk-PP-Detection/` 与 `node scripts/stage-pages-models.mjs` 均成功。

环境为 Windows 10.0.26200、Node 24.16.0、pnpm 11.16.0、Playwright 1.62.1、ONNX Runtime Web 1.27.0。报告证明本次本地开发依赖修复和上述既有验证通过；远程 CI、合并及 Pages 部署须以随后实际运行记录为准，不新增物理 GPU、移动端或微信宿主兼容结论。
