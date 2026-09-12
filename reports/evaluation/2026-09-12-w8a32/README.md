# PicoDet 与 PP-YOLOE W8A32 模型产物及评测

日期：2026-09-12。两款 W8A32 已生成，状态保持 **labs**。它们适合进一步评估模型下载体积，当前没有足够证据宣称推理加速。

## 产物

| 模型            |    FP32 大小 |  W8A32 大小 |  减少 | 模型版本           |
| --------------- | -----------: | ----------: | ----: | ------------------ |
| PicoDet-L-320   | 23,243,834 B | 6,117,685 B | 73.7% | 1.0.2-w8a32.labs.1 |
| PP-YOLOE+ S 640 | 31,954,220 B | 8,225,467 B | 74.3% | 0.1.1-w8a32.labs.1 |

本地成品位于 SDK 根目录 `.tmp/w8a32-artifacts/2026-09-12/`，每款含 ONNX、manifest.json、conversion.json，根目录提供接入说明、许可与第三方声明。本报告保留对应清单和转换证据；模型文件不进入 npm。

- PicoDet SHA-256：`3c46094c52437768373e55e2f4f320be3725399b5a906abea251cc30b7a06d59`
- PP-YOLOE SHA-256：`cef7cd4dbbac67db53c75f0a3aca30343a5fb9be0b743c57d9dca8dec0d48b2e`

PicoDet 保留前两个卷积为 FP32，压缩另外 112 个权重张量；产物与[上一轮评估](../2026-09-12-picodet-int8/README.md)逐字节一致，沿用该轮 20 组浏览器运行和检测差异证据。本轮没有重算 PicoDet 的性能排名。

PP-YOLOE 对优化图的 84 个卷积权重张量按输出通道对称量化，其他数据保持原有精度。多个卷积可能共享权重，张量数量不等于卷积节点数。两款的权重为 INT8 存储，DequantizeLinear 恢复后参与 FP32 卷积；激活、均值归约及浮点输入输出保持 FP32，检测数量保持 INT32。清单 `precision: int8` 只用于权重存储身份，`quantization: weight-only-int8-activation-fp32` 标明实际策略。

## 转换与质量

转换器位于 `tools/model-pipeline/weight_only.py`：先检查固定源模型 SHA-256，使用 ONNX 1.16.2 将 opset 11 转为 13，通过 ORT 1.20.1 BASIC 优化及 ONNX shape inference，然后按通道量化权重。保护显式排除的节点、被未选中消费者共享的权重，拒绝非有限数值、名称冲突和覆盖已有产物。完整 ONNX checker 通过。

W8A32 不量化激活，不需要图片校准。PP-YOLOE 使用原有固定 COCO val2017 64 图、716 条标注，通过 `pycocotools.COCOeval` 计算质量。这是开发子集，不是全量 COCO mAP，也不能用微小 AP 变化宣称更准确。

Python CPU 的 AP：FP32 为 43.3499，W8A32 为 43.3425。Python 路径使用 OpenCV 解码、Pillow bicubic 和既有 `/255` 输入，浏览器使用浏览器解码与 SDK 预处理，因此分别在各自环境内比较。

浏览器 PP-YOLOE AP：FP32 为 43.4265，W8A32 为 43.3640，下降约 **0.063 个 AP 点**，WASM/WebGPU 六次候选运行结果一致。

## PP-YOLOE 性能

本机 Windows 11 10.0.26200、Intel Core i5-10400F、NVIDIA Blackwell、Chromium 153.0.8010.12、ORT Web 1.27.0、SDK 0.3.1。main、WASM 单线程、跨域隔离、缓存关闭、SDK 后端回退关闭。物理 GPU 身份与原始 ORT 警告保留于每轮报告；部分节点由 ORT 分配给 CPU，不能把实际 WebGPU 后端理解为整图全部运行在 GPU。

每个后端交替三轮 FP32/W8A32，每轮新建浏览器与会话并顺序检测相同 64 图。下表为三轮统计量的中位数，热值排除首张，单位 ms。模型通过本机 HTTP 服务读取后以字节传入 SDK；不包含公网下载速度。端到端包含解码、预处理、推理、后处理与调度，图片获取在计时之外。

| 后端 / 模型    |      AP | 会话创建 | 热推理中位数 | 热端到端中位数 | 热端到端 P90 |
| -------------- | ------: | -------: | -----------: | -------------: | -----------: |
| wasm / FP32    | 43.4265 |   435.70 |       857.67 |         889.39 |       966.66 |
| wasm / W8A32   | 43.3640 |   392.92 |       857.12 |         892.40 |       962.34 |
| webgpu / FP32  | 43.4265 |  1183.89 |        50.51 |          87.12 |       150.79 |
| webgpu / W8A32 | 43.3640 |  1050.58 |        51.52 |          81.02 |       159.53 |

W8A32 热端到端相对变化：WASM +0.34%，WebGPU -7.00%。GPU 的端到端波动包含解码和预处理；W8A32 热推理没有体现稳定优势，不将表中总耗时较小当作量化加速证明。会话创建、首次推理等各轮数据见 summary.json。

## 逐框差异

阈值 0.5、同类 IoU ≥ 0.5 一对一匹配：WebGPU FP32 有 443 框，W8A32 有 438 框，匹配 426 框；FP32 未匹配 17，候选未匹配 12。匹配框最大分数差 0.082384，`[x,y,w,h]` 最大分量差 20.864 像素。WASM 的独立匹配结果保存在 parity/，AP 接近不代表逐框完全一致。

## 接入与复现

接入见 [本地模型使用说明](usage.md)。显式设置 `allowExperimental: true`、`precision: int8`，按模型字节和清单加载；两款均有独立版本与来源哈希，用于隔离模型和缓存身份。

复现前按现有 PP-YOLOE 指南准备源文件和 `.tmp/phase2` 环境。脚本从 SDK 根目录执行：

```powershell
$python = (Resolve-Path .tmp/phase2/venv/Scripts/python.exe).Path
& $python reports/evaluation/2026-09-12-w8a32/reproduction/reproduce-models.py .tmp/w8a32-rebuilt
```

`reproduce-models.py` 的 ROOT 默认指向本次仓库位置；其他机器先修改为实际路径。产物目录必须尚不存在。工具锁定输入清单中的原始 SHA-256，不能把其他同名 ONNX 当作源模型。两款重建结果的 SHA-256 均与上述已评测模型一致。

`reproduction/run-browser.py` 和 browser-probe.mjs 是本次评测快照，默认使用脚本旁的 artifacts/ 及仓库 `.tmp/phase2/dataset/images/`；修改 ROOT 后将重建产物复制到 artifacts/，从当前仓库稳定清单复制对应 fp32-manifest.json，可复现相同矩阵。原始 JSON 以 gzip 保存，artifact-index.json 校验压缩前后内容；summary.json 汇总正式三轮结果。

## 验证与边界

转换器的 7 项行为测试先失败再全部通过，覆盖真实 ORT 执行、零通道、共享权重、排除规则、非法数值、名称冲突、哈希和禁止覆盖。PP-YOLOE 完成 2 组 Python 及 12 组浏览器完整子集推理。规范与相关测试见 verification.json，归档身份检查见 integrity-verification.json。

两款候选保持 labs，尚未公开上传 ModelScope/Hugging Face 或接入线上 Demo。未验证手机候选、峰值内存、连续视频及大规模独立数据集；文件体积减少不能直接推导运行时内存减少。PicoDet 既有 FP32 手机反馈不覆盖新 W8A32。

建议先作为可选的小体积模型验证；如果希望提升推理帧率，当前 W8A32 不是已证实的加速方案。稳定 FP32 模型与 SDK 0.3.1 保持现状。
