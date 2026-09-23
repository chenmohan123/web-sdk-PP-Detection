# WebNN / NPU 本机可行性验证

日期：2026-09-14。验证目标是判断 Detection SDK 能否在 CPU、GPU 之外开放真实 NPU 执行选项，并据此规划全部模型覆盖。本轮属于单 SDK 后端评估，只归档证据。

结论：**本机未验证通过物理 NPU，暂不开放稳定 NPU 选项。** 实验开关下请求 `deviceType: "npu"` 并计算正确，不等于已经调用物理 NPU。本轮完整 Detection 模型的 NPU 推理次数为 **0**；兼容性为“未验证”，不能解释成全部兼容或全部不兼容。

## 环境与结果

- 系统：Windows 11 专业版 10.0.26200。
- CPU：Intel Core i5-10400F；显卡：NVIDIA GeForce RTX 5060 Ti。PnP 查询未发现 NPU / ComputeAccelerator 设备，详见 [硬件记录](hardware.json)。
- Chrome 153.0.8010.37、Edge 153.0.4234.32、Chromium 153.0.8010.12。
- SDK 0.4.0，提交 `19346d200c2993d92e37838ab43aea236ed516a8`，依赖 ORT Web 1.27.0。最小图探针直接调用浏览器 WebNN，没有经过 ORT Web 或 SDK。
- 页面由本机 `127.0.0.1` 提供，`isSecureContext` 为 true，排除局域网 HTTP 非安全上下文造成 API 不可见的情况。

| 场景 | WebNN API | 请求 NPU 后最小 Add 结果 | 实际物理 NPU |
| --- | --- | --- | --- |
| Chrome / Edge / Chromium，无头，默认配置 | 均未开放 | 未执行 | 未验证 |
| Chrome / Edge / Chromium，无头，实验开关 | 均开放 | 各 1/1 正确 | 未验证 |
| Chrome / Edge，有头，默认配置 | 均未开放 | 未执行 | 未验证 |
| Chrome / Edge，有头，实验开关 | 均开放 | 各 5/5 正确 | 未验证 |

实验开关为 `--enable-features=WebMachineLearningNeuralNetwork`。浏览器均使用 Playwright 隔离配置；初轮无头运行包含 Playwright 默认参数。有头复核移除了默认 `--enable-unsafe-swiftshader`，仍保留其他 Playwright 默认参数，因此也不是用户日常浏览器配置的全量兼容测试。

## 为什么不能据此显示 NPU

无头 Chrome / Edge 的原生日志出现以下错误，见 [筛选日志](native-webnn.json)：

```text
[WebNN] Failed to create package dependency for package: Microsoft.WindowsAppRuntime.2_8wekyb3d8bbwe
[WebNN] Failed to create ONNX Runtime environment: Failed to get ONNX Runtime platform functions.
```

Edge 同时记录 `WebNN.ORT.TryCreatePackageDependency.ErrorResult`，错误值为 `-2140733418`，见 [后端诊断](edge-backend.json)。这是浏览器的 Windows 原生 ORT 依赖问题，不是 SDK npm 包的 ORT Web 加载错误。有头复核没有再次捕获该日志或直方图，不将无头诊断推定为每种启动条件都发生同样错误。

与本机 Chrome **同版本**的 Chromium 源码显示：Windows ORT 初始化或设备选择失败后，CPU / NPU 请求可转入 renderer 进程的 TFLite/LiteRT 后端；Blink 会把该回退继续包装为成功的上下文。源码节选、版本 URL 和保存文件摘要见 [源码证据](source-evidence.json)。Edge 为独立发行版，该源码不作为其内部实现完全相同的证明。

本轮没有取得实际 NPU 设备身份或硬件执行记录。API 是否存在、上下文是否成功、运算是否正确、实际执行设备，是需要分别验证的条件。

## 保留的异常与范围限制

无头 Chrome 的实验 **WebNN GPU** Add 对照五次均错误：首次输入 `[1,2,3,4]` 加常量 `[2,3,4,5]`，期望 `[3,5,7,9]`，实际 `[3,4,5,6]`；同次 NPU 请求五次均正确，见 [变化输入对照](chrome-control.json)。本轮未定位该实验路径的具体错误原因，也未做该 GPU 异常的有头复测。

该异常不属于 SDK 当前使用的 `onnxruntime-web/webgpu` 路径，不能外推为线上 Demo GPU 检测失败。现有 SDK 只声明 `wasm` / `webgpu`；本轮未修改 runtime、Demo、模型清单、权重或版本，也未重新执行现有模型的 CPU / GPU 回归。

## 后续接入条件

CPU / GPU / NPU 可以成为同一个 SDK 的统一选项，但应按设备、浏览器、模型、精度的验证矩阵启用，不能通过一次能力探测就让全部模型默认支持。

1. 在具有物理 NPU 的设备上，确认驱动、浏览器 WebNN、原生后端依赖，并用设备身份和执行跟踪确认实际 NPU 工作；排除 CPU / GPU 回退。
2. 使用 ORT Web 的 WebNN 入口，先验证 PicoDet FP32 完整推理，再覆盖已发布 PicoDet 与 PP-YOLOE+ S/M/L/X 的 FP32、FP16、W8A32 及后续新增规格。分别检查算子分区、编译、检测精度、冷暖耗时、取消与释放、main / Worker 支持。部分算子回退时如实记录，不能标为全图 NPU。
3. W8A32 当前仅压缩权重，激活和卷积计算保持 FP32，不能等同于原生 INT8 NPU 模型；必要时另行转换和验证。
4. 实测通过后，先更新门户标准的 backend schema / rules，再接入 SDK 后端选择、实际后端报告和 Demo。未验证或不支持的组合禁用并说明原因，禁止静默回退后显示 NPU。

这符合既有标准“请求后端与实际后端分开报告”和“NPU only when verified”的要求。PicoDet FP32 补齐工作可以独立推进；NPU 验证不会成为其 CPU / WebGPU 发布前置条件。

## 复现与证据

- [摘要](summary.json) 固定本轮决策、SDK 身份、各浏览器结果和限制。
- `headless-probe.json.gz` 与 `headed-npu.json.gz` 保存完整 API 探针，包括算子类型限制；用 gzip 解压后为 JSON。
- `reproduction/headless-probe.mjs`、`chrome-control.mjs`、`edge-backend.mjs` 保留初轮脚本原始字节，含本机 SDK / 浏览器绝对路径；换设备时需要修改路径。它们输出至系统 TEMP。
- 有头探针支持 SDK 根目录和输出目录参数，不修改日常浏览器配置；运行时会短暂打开 Chrome / Edge 隔离窗口。未安装的浏览器会记录启动错误。

从 SDK 根目录执行：

```powershell
$env:PPDETECTION_REPO = (Get-Location).Path
node reports/evaluation/2026-09-14-webnn-npu/reproduction/headed-npu.mjs "$env:TEMP/ppdetection-webnn-rerun"
```

输出目录须使用新名称。原始浏览器日志只留在 TEMP；归档仅筛选 `[WebNN]` 行。有头脚本的 `scriptSha256` 与归档脚本相绑定。初轮 probe 也记录脚本 SHA-256；后端诊断和变化输入对照没有运行时脚本摘要，仅保留本轮归档时的文件摘要。

变更前后均用不包含历史临时目录的源码快照运行 `pnpm sdk:check -- --repo <快照>`，结果见 `standard-before.json` / `standard-after.json`。静态标准检查不证明 NPU 推理通过。归档文件字节摘要见 `artifact-index.json`。

参考：[ORT Web WebNN 入口](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html)、[Chromium 同版本回退代码](https://github.com/chromium/chromium/blob/153.0.8010.37/services/webnn/webnn_context_provider_impl.cc#L823)。
