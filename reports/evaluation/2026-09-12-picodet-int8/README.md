# PicoDet INT8 可行性评估

日期：2026-09-12。结论：**当前静态激活 INT8 候选不适合接入稳定模型；W8A32 权重压缩有体积收益，保持本地 labs。**

SDK 使用已发布的 0.3.1，稳定模型为 PicoDet-L-320 1.0.1 FP32。评估生成五个候选，完成七组 Python CPU 子集推理、二十组浏览器完整子集推理。线上 Demo、稳定清单、模型资产及 npm 版本均未修改。

## 主要结果

下表 AP 为 0–100，来自固定 COCO val2017 64 张图片、716 条标注，不是全量 COCO 成绩。浏览器数据来自实际 SDK 入口。`QDQ` 和 `QOperator` 的权重均为按输出通道 INT8，激活分别是 S8 和 U8，前两层保留 FP32 的候选属于混合精度。

| 候选                              | 大小（十进制 MB） | Python AP | WASM AP | WebGPU AP | 判断                       |
| --------------------------------- | ----------------: | --------: | ------: | --------: | -------------------------- |
| 稳定 FP32                         |            23.244 |   34.3167 | 34.2153 |   34.2153 | 基线                       |
| QDQ S8S8，114 个卷积量化          |             6.461 |    0.0727 |  未运行 |    未运行 | Python 质量已失败          |
| QOperator U8S8，114 个卷积量化    |             6.180 |    0.0583 |  未运行 |    未运行 | Python 质量已失败          |
| QDQ S8S8，保留前两个卷积          |             6.461 |   29.2371 | 29.8441 |   30.0965 | 精度下降，运行更慢         |
| QOperator U8S8，保留前两个卷积    |             6.181 |   28.7387 | 29.6794 |   30.6014 | 精度下降，运行更慢         |
| W8A32，仅压缩权重，保留前两个卷积 |             6.118 |   34.1892 | 34.2606 |   34.2606 | 体积减少 73.7%，无速度收益 |

W8A32 的 112 个卷积权重保存为 INT8，通过按通道 DequantizeLinear 还原；激活、输入输出和卷积计算仍为 FP32。实验清单用 `precision: int8` 标识权重存储，`quantization: weight-only-int8-activation-fp32` 明确实际策略。它不代表整数卷积加速，也不能由文件变小推断峰值内存或 GPU 显存同比减少。

## 校准、转换与异常定位

静态激活量化使用 128 张单独选择的 COCO val2017 图片；固定种子 `picodet-int8-calibration-v1`，按现有场景分桶，先排除全部 64 张评测图片，交集为零。图片锁包含逐图 SHA-256、大小、许可和公开下载地址。校准与评测均来自 val2017 的不同子集；本次只作可行性实验，后续稳定验证需要独立保留的数据集。

旧 `tools/model-pipeline/picodet/quantize_int8.py` 只除以 255，遗漏稳定清单要求的 ImageNet 均值和标准差。本次实验未调用它量化，而是读取稳定清单生成 bicubic、RGB、除 255、归一化、NCHW 的校准输入；首张校准图的新旧张量最大绝对差为 2.1179。原工具留待独立修复，复现本次结果应使用本目录实验脚本。

稳定源模型为 opset 11。为支持 QDQ 按通道轴语义，通过 ONNX 1.16.2 版本转换器升到 opset 13，再使用 ORT 1.20.1 的 BASIC 图优化及 ONNX shape inference。转换和优化后的 FP32 在固定 64 图上与源模型 **6224 个预测逐项完全相同**。所有候选通过完整 ONNX checker；原始稳定模型 SHA-256 保持不变。

直接量化的首层输出出现约 -1936～2001 的宽动态范围。在诊断图片 270244 上，下一深度卷积相对 RMS 误差达到约 0.67，再下一卷积超过 1；这是误差在前端放大的证据，不是对全部图片的误差上界。只保留 `Conv_0`、`Conv_1` 为 FP32 后，AP 从接近零恢复到约 29，但仍未达到本次 AP 下降不超过 1 个百分点的初筛目标。

最后生成 W8A32：同样保留前两个卷积，其他权重按通道对称量化，激活完全不量化。该方案不使用图片校准。重新生成的模型逐字节相同，SHA-256 为 `3c46094c52437768373e55e2f4f320be3725399b5a906abea251cc30b7a06d59`。

## 浏览器性能

环境：Windows 11 `10.0.26200`、Intel Core i5-10400F、NVIDIA Blackwell、Chromium 153.0.8010.12、ORT Web 1.27.0、SDK 0.3.1，main 模式，WASM 单线程。浏览器未使用特殊 GPU 启动参数，检测到物理 GPU；禁止 SDK 后端回退。ORT 的部分节点分配到 CPU 警告保留在原始报告，不能据此宣称整图都在 GPU，也未单独量化节点传输占比。

QDQ/QOperator 保留前两层候选各一次完整浏览器质量筛查：WASM 热端到端约 334 ms，FP32 为约 292 ms；WebGPU 分别约 844/693 ms，FP32 约 61 ms。未通过质量筛查的候选不做重复性能排名。

W8A32 与 FP32 使用相同 64 图，交替三轮（编号 2–4），每轮新建浏览器和会话。热值排除每轮首张，表格取三轮统计量的中位数，单位 ms。编号 1 为探索期，未混入正式三轮汇总。检测总耗时包含解码、预处理、推理、后处理和调度；图片获取在计时外。

| 指标                  |    FP32 |   W8A32 |
| --------------------- | ------: | ------: |
| wasm 会话创建         |  403.68 |  478.13 |
| wasm 首张端到端       |  374.55 |  369.28 |
| wasm 热推理中位数     |  269.89 |  273.58 |
| wasm 热端到端中位数   |  291.76 |  295.05 |
| webgpu 会话创建       | 1174.66 | 1185.50 |
| webgpu 首张端到端     | 3170.50 | 3254.09 |
| webgpu 热推理中位数   |   37.16 |   40.87 |
| webgpu 热端到端中位数 |   58.19 |   61.70 |

W8A32 热端到端在本机 WASM 略慢约 1.1%，WebGPU 约慢 6.0%。它的优势是模型文件从 23,243,834 降至 6,117,685 字节；本次模型通过本机服务提供，以字节传入 SDK，不包含公网下载时间，不能承诺固定的下载加速比例。首次推理时编译和缓存状态也会影响冷启动。

## 检测结果差异

W8A32 与 FP32 的子集 AP 接近，不代表逐框相同或更准确。阈值 0.5、同类别 IoU ≥ 0.5 的一对一匹配中，两种浏览器后端均为：基线 293 框、候选 298 框、匹配 290 框，基线未匹配 3 框、候选未匹配 8 框。最大分数差约 0.06135，匹配框 `[x,y,w,h]` 的最大分量差约 69.86 像素。逐图匹配记录保留于 `evidence/*-weight-parity.json.gz`。

Python 推理使用既有评测入口的 OpenCV 解码与 Pillow bicubic/float32 归一化；浏览器使用浏览器 JPEG 解码和 SDK 预处理。跨 Python/浏览器的差异不单独归因为量化，质量和速度均优先在相同后端内对比。

## 证据与复现

- `summary.json`：全部浏览器运行、正式三轮指标和匹配摘要。
- `source-evidence.json`：SDK 构建、转换和评测入口、清单、锁文件的身份。
- `artifact-index.json`：归档文件压缩前后字节数与 SHA-256；JSON 使用 gzip 原样保存。
- `evidence/`：五个候选转换、FP32 转换一致性、中间层误差和匹配记录。
- `calibration/`：128 图选择、标注和逐图来源锁；不包含图片。
- `browser/`、`python/`：原始预测、计时、运行时与 COCOeval 指标。
- `manifests/`：本地实验清单，来源仅为探针本机服务，不能用于公网分发。
- `reproduction/`：一次性实验脚本快照，不作为 SDK 产品代码或通用量化器。

复现需要仓库 0.3.1 构建、原有 `.tmp/phase2` Python 环境、COCO 原始标注与 64 张评测图片。依赖版本见转换记录，沿用 `tools/model-pipeline/ppyoloe/requirements.lock`。脚本快照的 `ROOT` 指向本次 SDK 仓库；在其他路径复现时，先将各脚本中的 `ROOT` 改为实际仓库根目录。所有脚本必须从 SDK 根目录执行，模型生成脚本拒绝覆盖已有产物。

```powershell
$probe = Join-Path $env:TEMP 'picodet-int8-reproduction'
New-Item -ItemType Directory $probe
Copy-Item reports/evaluation/2026-09-12-picodet-int8/reproduction/* $probe
$python = (Resolve-Path .tmp/phase2/venv/Scripts/python.exe).Path
& $python "$probe/prepare.py"
& $python "$probe/quantize.py"
& $python "$probe/quantize-stem.py"
& $python "$probe/weight-only.py"
node "$probe/prepare-browser-weight.mjs" $probe
& $python "$probe/run-python.py"
& $python "$probe/run-python-stem.py"
& $python "$probe/run-python-weight.py"
& $python "$probe/run-browser.py"
& $python "$probe/run-browser-weight.py"
& $python "$probe/run-browser-comparison.py"
& $python "$probe/summarize.py"
```

## 验证范围和后续结论

本轮评测入口 5 项 Node 测试和 25 项相关 Python 测试通过；20 组浏览器运行均通过严格后端/模式检查，模型可运行与质量合格分别判断。规范检查前后记录保存在本目录。公开模型和原始图片均未上传，SDK 源码与已发布版本未改动。

小米 15 对 FP32 的既有反馈不适用于这些新候选。本次没有手机 INT8/W8A32 实测、峰值内存、长时间视频、完整 COCO 或全设备验证。候选选择过程中使用了此评测子集作诊断，因此它是开发验证集；在新的独立图片集复核后才可作稳定接入决策。

建议保留当前 FP32。若目标是减少下载量，W8A32 值得后续在小米及更大独立数据集上评估；若目标是提高手机 CPU 帧率，现有静态量化方案没有支持证据，应另行考虑量化友好的模型导出或量化感知训练。当前候选全部保留 labs，不发布模型或改 Demo。
