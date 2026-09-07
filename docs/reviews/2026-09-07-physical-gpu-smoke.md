# 物理 GPU 测试修复与复测

日期：2026-09-07。本轮只修改浏览器测试与配置，SDK 版本仍为 0.1.1，模型仍为 PicoDet 1.0.1 FP32。

## 根因与修复

物理 GPU 用例原先使用默认 headless shell，在本机没有 WebGPU 适配器，导致跳过。完整 Chromium 可以取得 NVIDIA 物理适配器；因此显式真实模型测试改用完整 Chromium，且 FP32 物理 GPU 用例要求非软件适配器，不能因缺少适配器而跳过后显示成功。

继续执行后发现两处测试问题：未指定 ONNX Runtime 的 WASM 资源目录，向 `/dist/ort-wasm-simd-threaded.asyncify.wasm` 请求得到 404；修正路径后，原文档版面示例 `table.png` 没有可检测的人物等目标，返回零结果，与测试断言冲突。

FP32 用例现在使用已提供的 `/ort/` 资源，并加载仓库已有的 `people.jpg`。断言真实结果包含 `person`、推理耗时大于零、实际后端为 WebGPU、精度为 FP32、没有 SDK 后端回退。测试附件记录日期、浏览器、适配器、模型和结果。

## 证据

- Windows 11，NVIDIA GeForce RTX 5060 Ti，驱动 32.0.16.1074，Chromium 151.0.7922.34，ONNX Runtime Web 1.27.0。
- 适配器 vendor 为 `nvidia`，architecture 为 `blackwell`，`isFallbackAdapter: false`。
- 线上 Demo 默认 ModelScope、显式 GPU FP32：`people.jpg` 检测到 12 个目标，含 person 和 kite，页面无未捕获异常。
- 模型 SHA-256：`0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。
- 修复后的 `PPDETECTION_REAL_MODEL=1 pnpm exec playwright test tests/browser/runtime.spec.ts --grep "FP32 WebGPU"`：1 项通过，模型来源显式设为 ModelScope，并提供当前清单 URL。
- `pnpm run verify` 完整通过：文档 6 项、发布/仓库契约 20 项、基准契约 6 项、基准比较 14 项、SDK 116 项，格式、lint、类型和构建通过。
- 修改前后标准检查均为 18 项 required 通过、0 失败、4 项远程规则跳过。

本次不是性能基准或精度对齐测试，不扩展 FP16、其他 GPU、操作系统或浏览器的兼容承诺。本机直接完成验证，没有启动或迁移 runner；需要 runner 时按用户指定使用 `F:\github-runner`。
