# Detection 示例与缓存整改验收

- 时间：2026-09-07 至 2026-09-08，Asia/Shanghai。
- 分层：单 SDK。基线 main `bca3ac5`，提交分支 `codex/fix-examples-cache`；本记录用于合并前验收，远程交付结果另存于门户本轮报告。
- 已读门户 AGENTS.md、标准 v1 README、SDK/Demo/Examples 契约、rules.yaml、manifest schema，以及原审计 `reports/sdk-standard/2026-09-07-followup/detection-followup-audit.md`。
- 修改前 checker 由主任务完成。修改后原始报告见 [2026-09-08-examples-cache-check.json](2026-09-08-examples-cache-check.json)：18 required pass、0 fail、4 skip、3 recommended pass，状态仅为 locally-compliant。

## 修复与边界

六个入口（React、Vue、Vanilla Vite、微信 H5/WebView、Vanilla DOM、CDN）均明确传入官方 PicoDet-L-320 v1.0.1 的 ModelScope 清单和 `source: "modelscope"`。四个独立 package 固定公开 npm `web-sdk-pp-detection@0.1.1`，CDN 同样固定 0.1.1；所有目录补齐运行说明，静态入口固定 ORT 1.27.0 资源路径。

自动后端显式允许 `allowFallback: true`；当前环境虽暴露 GPU API，但 headless shell 无可用 GPU adapter，因此实际执行 WASM，结果保留后端和回退记录。模型来源没有自动切换。每个入口使用同步 AbortController 锁，取消和卸载后由 finally 统一释放包括迟到实例在内的会话。

ModelManager 对共享存储范围使用失效代次与队列，覆盖下载、缓存读取/写入、损坏缓存删除、当前清理和全部清理。候选来源的 guard 在进入任何异步阶段前捕获，防止 auto 后备来源绕过清理；共享自定义缓存使用引用计数，单个 manager 释放不会注销仍在使用该缓存的其他 manager。

新增可选 `ModelCache.scope` 与 `list()`，`ModelManager.getCacheEstimate({ id, version })`、`clearCurrentModelCache({ id, version })` 按真实清单身份处理全部变体和来源。未传身份的当前清理保持原缓存键行为，其他旧签名保持兼容；缺少 list 的自定义缓存拒绝按身份操作，避免扩大删除范围。SDK 命名空间之外的数据保留。容量按键去重，代表模型缓存字节而非站点配额或进程内存。

Demo 展示当前模型/全部本 SDK 容量和两个 `data-sdk-cache-clear` 入口。清理同步互斥，先取消并等待在途加载/检测，释放会话，再清理并刷新；错误能显示并重试。当前身份来自配置或实际下载清单，自定义清单撤销后恢复默认身份。视频只补充清理所需的迟到启动取消保护，未扩大到每帧会话复用、耗时或后端报告整改。

并发协调限定同一 JavaScript 执行环境内的共享数据库；不同标签页/Worker 的独立运行时并发写入不在本轮保证内。未执行真实微信设备或 WebNN/NPU 验证，不将桌面结果泛化为设备兼容承诺。

主任务另在本机完整 Chromium 的非 fallback GPU adapter 上验证候选 Demo：真实 ModelScope 清单与模型、真实 WebGPU 推理均成功，当前/全部两种清理分别将 23,243,834 字节模型缓存清至 0，第二轮可以重新创建会话并检测。原始证据位于门户 `reports/sdk-standard/2026-09-07-examples-cache/detection-candidate-cache.json`。

## 红绿证据

| 回归                                       | 修复前观察                              | 修复后                                        |
| ------------------------------------------ | --------------------------------------- | --------------------------------------------- |
| 延迟 fetch → current/all clear → 放行      | 两种清理均从 0 B 回填到 4 B             | 旧下载结束仍为 0 B                            |
| clear → 新加载完成 → 旧加载迟到            | 旧任务再次调用 put                      | 不覆盖/删除新缓存                             |
| auto 第一来源延迟失败后回退                | 后备来源捕获新代次并写回                | 同一个旧 load 的全部来源均失效                |
| 同一 custom cache 双 manager，释放其中一个 | 幸存 manager 清理为空操作               | 引用计数保留清理能力                          |
| 按模型身份估算/清理                        | 返回所有数据 19 B 而非当前 8 B          | 当前模型跨变体清理，其他模型/SDK 保留         |
| 六个示例入口契约                           | 10 项全部失败（模型/版本/生命周期缺失） | 10 项通过                                     |
| Demo 下载中点击 current 清理               | 找不到所需清理入口                      | 取消后 0 B，可重新检测，再清到 0 B            |
| 真实模型示例会话创建                       | 无 GPU adapter；静态入口 ORT 路径错误   | 显式后端回退和固定 ORT 资源后全部得到检测结果 |

补充回归覆盖已开始的 put 事务、迟到损坏校验、清理异常恢复、真实 IndexedDB 跨管理器/独立数据库隔离、模块清理活动内存副本、Demo 快速双击与迟到视频 play。

## 执行结果

所有 pnpm 命令使用进程环境 `pnpm_config_verify_deps_before_run=false`。Playwright 临时缓存和部分既有文件/工作目录受到沙箱 ACL 限制，受影响命令以宿主机权限重跑；没有删除旧工作目录或修改登录状态。

| 命令                                                                        | 结果                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm test`                                                                 | 17 文件、127 项通过                                                                 |
| `pnpm typecheck`、`pnpm --filter @ppdetection/demo typecheck`               | 通过                                                                                |
| `pnpm lint`                                                                 | 通过；测试保存原型方法的 this 绑定已说明                                            |
| `pnpm docs:test`、`pnpm examples:check`                                     | 6 项、10 项通过                                                                     |
| `pnpm release:test`、`pnpm benchmark:test`                                  | 20 项、6 项通过                                                                     |
| `pnpm format:check`                                                         | 宿主机权限下通过                                                                    |
| `pnpm build`、`pnpm --filter @ppdetection/demo build`                       | SDK 和 Demo 生产构建通过                                                            |
| `pnpm --filter @ppdetection/examples-tests test`                            | 14 项通过：四个目录原样复制到仓库外安装公开 0.1.1 并构建；独立补充 tarball 消费构建 |
| `pnpm exec playwright test tests/browser/model-cache.spec.ts`               | 4 项通过，真实 IndexedDB                                                            |
| `pnpm exec playwright test tests/browser/picodet.spec.ts --grep "WASM/CPU"` | 当前源码 SDK 的真实官方模型 Session/推理通过，测试文档图片返回 2 个目标             |
| `pnpm --filter @ppdetection/demo test`                                      | 30 项通过，含真实 WASM、缓存、覆盖框恢复、输入竞态、视频取消、390px 及宽屏布局      |
| `pnpm exec playwright test tests/browser/examples-runtime.spec.ts`          | 12 项通过：六个入口重复点击/取消，以及真实官方模型推理                              |
| `PPDETECTION_EXAMPLES_EXTERNAL=1` 下运行 CDN 推理用例                       | 真实外网未拦截请求，1 项通过                                                        |
| 修改后 `pnpm sdk:check -- --repo ... --format json --out ...`               | 退出 0，详情见配套 JSON                                                             |

示例浏览器测试中的模型为官方 23,243,834 字节 ONNX，SHA-256 为 `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。
六个入口均使用原始公开 npm SDK 与真实 ORT，在 `people.jpg` 上返回 12 个目标。常规烟测仅将模型和静态 SDK 的远程字节替换为已校验本地原件，没有替换工厂、会话或推理；外网 CDN 轮次完全不拦截请求，实际访问 jsDelivr SDK、ORT 与 ModelScope 清单/模型。

`PPDETECTION_EXAMPLES_REUSE=1` 仅用于诊断和外网复查时跳过重复安装；最终 12 项常规烟测没有设置该变量，四个目录再次按原 package.json 安装并构建。工作区锁文件已同步为公开 SDK 0.1.1，消费者原样构建测试不再改写依赖；改写为 tarball 的验证被明确放在独立补充用例中。

最终容量复查还发现：独立估算管理器仅查看自身层级缓存会漏掉其他活动管理器在持久写入失败时保留的内存副本。新增共享 scope 的真实内存缓存测试，先观察 0 B/预期 4 B 失败，再将容量汇总范围改为该 scope 内全部已注册缓存并按键去重；22 项 ModelManager 测试及 127 项 SDK 测试通过。

补充像素回归确认原实现清理结果后仍残留检测框（与原图有 495,121 个通道值不同）。结果清空时改为重绘原始图片或当前视频帧，current/all 两个动作均恢复到像素差 0。原有黑色单像素测试的检测框绘制断言移至清理前，清理后的原图恢复由该独立像素回归验证；最终完整 Demo 30 项通过。
