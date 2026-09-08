# 运行时与耗时整改验证

日期：2026-09-08（Asia/Shanghai）。范围：单 SDK 与当前模型 Demo。
本记录按标准 v1 的 Demo、发布检查模板组织；本轮只合并源码并发布 Pages，npm 仍为 0.1.1。

## 修复与回归证据

- 初始化计时从公开工厂入口开始，包含能力探测、清单、模型获取、完整性校验和会话。受控时间回归在旧实现为 61ms，正确预期为 188ms；内存校验旧值 0ms，正确预期为 11ms。
- 模型获取来源区分 network、cache、memory；ORT 版本读取实际会话，未知版本保持 null；每次检测保存独立运行环境及回退记录快照。
- Worker GPU 推理失败时保留 CPU 重试输入。真实 WorkerBridge 配合原生 structuredClone 转移的回归，修复前抛出 DataCloneError，修复后 CPU 收到完整像素且下一次检测成功。
- Demo 视频、摄像头按配置复用会话；图片每次初始化。连续两帧清单请求从 2 次减少为 1 次；视频切摄像头后轨道从错误的 ended 恢复为 live。测试覆盖阈值、精度、后端、自定义清单、停止、清缓存及输入切换。
- Demo 初始化总耗时包含自身清单获取。测试给清单获取增加受控 5000ms，修复前只显示 922ms，修复后正确包含该阶段。运行区域显示真实 ORT 1.27.0 和浏览器环境。

## 验证入口

- `pnpm verify`：格式、文档、示例契约、发布契约、基准契约与 parity、lint、SDK 类型、单元测试、SDK/Worker/IIFE 构建。
- `pnpm --filter @ppdetection/demo typecheck`、`pnpm --filter @ppdetection/demo build`。
- `node apps/demo/node_modules/playwright/cli.js test --config apps/demo/playwright.performance.config.ts`：全部 35 项 Demo 浏览器回归，使用独立 4298 端口。
- 门户 `pnpm sdk:check -- --repo ../web-sdk-PP-Detection`：修改前后均保留 JSON，远端治理项另核对 GitHub。

## 真实模型与边界

Windows Chromium 151、NVIDIA Blackwell 非软件回退适配器、ORT 1.27.0、官方 PicoDet FP32 模型已验证 main/Worker WebGPU，每种模式覆盖网络获取、缓存命中、同会话两次检测。四次会话均检测到 12 个目标，包含 person；初始化及运行元数据断言通过。

模型 SHA-256：`0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`，大小 23,243,834 字节。模型传输替换为本机已校验的相同官方字节，实际 SDK、ORT 和 GPU 保持真实；该结果不证明模型托管站网络可用性，也不是普遍性能基准。GPU 失败回退采用可控故障和真实缓冲区转移验证，不将其表述为物理 GPU 故障测试。

FP16、量化变体、NPU、移动设备和微信 WebView 未新增兼容承诺；当前性能文档已撤下与现有 PicoDet 清单不符的历史 FP16 声明。

门户证据目录：`reports/sdk-standard/2026-09-08-runtime-performance/`，保存 GPU 原始 JSON、标准检查、PR/CI/Pages 提交对应关系和线上验收记录。
