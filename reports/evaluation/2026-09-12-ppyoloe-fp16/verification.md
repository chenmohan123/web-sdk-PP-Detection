# 本轮改动与验证记录

日期：2026-09-12。基线为 `567724cfd067e943cd5413261c5ad2d6b7c5a836`（已发布 SDK 0.3.0）。本轮完成发布收尾和 FP16 可行性评测；稳定 runtime、默认模型和 npm 版本保持 0.3.0。

## 发布收尾

六类独立示例使用公开 npm 0.3.0；更新当前模型说明，保留历史发布报告。npm 发布后的元数据等待由约两分钟延长为最多十分钟，每次请求最多十秒，重试网络错误、404、429 和服务端错误；永久错误及无效包身份/完整性返回失败并保存报告。等待脚本只读 registry，发布仍只执行一次，旧标签和历史失败记录不改写。

回归覆盖超过两分钟的传播延迟、临时失败、401、错误版本/完整性、空 JSON 和十分钟截止。新增测试先复现缺实现及空 JSON 异常，再验证修正。真实 `web-sdk-pp-detection@0.3.0` 查询一次成功，完整性与既有发布记录一致，见 [npm-publication.json](npm-publication.json)。

## 验证

| 项目                                              | 结果                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| SDK `pnpm lint` / `pnpm typecheck` / `pnpm build` | 通过                                                                                |
| SDK `pnpm test`                                   | 19 个文件、136 项通过                                                               |
| `examples/tests/examples.test.ts`                 | 14 项通过，含工作区外公开版本安装/构建和本地 tarball 消费                           |
| `tests/browser/examples-runtime.spec.ts`          | 12 项通过：六类取消/重入和六类真实模型推理                                          |
| `scripts/check-doc-parity.test.mjs`               | 5 项通过                                                                            |
| 发布、依赖、仓库、等待及示例契约                  | 35 项通过                                                                           |
| Git 可见文件格式检查                              | 280 个可格式化文件通过                                                              |
| 真实 npm 元数据                                   | 一次请求成功，SHA-512 与 provenance 地址已保存                                      |
| FP16 转换、全部存储常量有限性、ONNX full check    | 两版候选通过，重新转换的 SHA-256 一致                                               |
| CPU 质量评测                                      | 两版候选各 64 张；FP32 引用同一子集的历史 Pillow 质量记录                           |
| 正式浏览器实验                                    | 15 轮 × 64 张全部完成；默认 FP16 的 WebGPU 质量失败，已明确拒绝该候选               |
| 归档探针复现冒烟                                  | 新目录 1 张真实 WebGPU 推理通过，预测与原首张逐项相同                               |
| 标准检查                                          | before / after 均 required 18 通过、0 失败、4 远程项 skip；仅声明 locally-compliant |

示例浏览器测试安装的是公开 npm 原包，模型请求由已校验的官方 PicoDet 本体本地响应；不替换 SDK API 或推理。四个需要构建的示例重新安装 0.3.0，不复用旧 0.2.0 依赖。该结果不等于微信原生小程序或手机 WebView 兼容性测试。

## 本机执行适配

- 门户的 Playwright 使用本机匹配的 Chromium 1234 缓存；SDK 的真实 GPU 评测使用 `.tmp/dependencies-compatible-browsers` 中 Chromium 153，两个浏览器路径不混用。
- 独立消费者 Vitest 需显式设置 `npm_execpath` 指向 `C:/nvm4w/nodejs/node_modules/corepack/dist/pnpm.js`；直接调用 Vitest 或本机 `pnpm exec` 不提供该值。成功运行的命令为设置该变量后 `node node_modules/vitest/vitest.mjs run examples/tests/examples.test.ts`。
- 设置 `pnpm_config_verify_deps_before_run=false`，避免 pnpm 对既有宿主缓存做隐式修改。
- Prettier 沿用仓库配置与忽略规则，扫描 Git 可见文件，避免历史缓存 ACL 错误。
- 标准检查直接扫描被历史 `.tmp/release-0.3.0-pytest` 的 ACL 拒绝。改用全部 Git 可见文件（含未提交改动和新增报告）的逐字节快照运行同一检查器；哈希清单、原始失败原因和 before/after 报告保存在门户 `reports/sdk-standard/2026-09-12-detection-followup/`。没有修改历史缓存、权限或标准规则。

FP16 候选的小米 15、其他移动 GPU、峰值内存和公网下载收益尚未验证。下一阶段应根据体积需求决定是否继续接入，不能把本次观察写成普遍加速或稳定兼容承诺。
