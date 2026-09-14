# PP-YOLOE+ S/M/L/X 640 FP32 复现

所有命令从仓库根目录执行。本文复现已随 SDK 0.3.0 发布的 PP-YOLOE+ S 640 FP32。当前 S 稳定清单为 0.1.1，M/L/X FP32 稳定清单为 0.1.0，固定来源与清单见[模型目录](../../../models/README.md)。下方生成的是用于复现实验的本地清单。来源、指标和限制见[评测报告](../../../reports/evaluation/2026-09-11-ppyoloe/README.md)。

导出脚本现支持官方 PP-YOLOE+ S/M/L/X 四种规格。S 沿用既有 `sources.lock.json`；M、L、X 使用脚本内置的官方权重字节数和 SHA-256 校验，并分别校验对应配置文件及共享 reader。通过 `--variant m|l|x` 选择规格，导出目录名会随规格变化；未指定时保持 S 的兼容行为。四种规格仍需分别完成 ONNX 修复、桌面 WASM/WebGPU 验证和模型清单后才能发布。

2026-09-12 完成 [FP16 可行性评测](../../../reports/evaluation/2026-09-12-ppyoloe-fp16/README.md)：定向修正后体积约减半；后续三精度稳定发布见模型目录，原评测保持历史证据。

## 环境、来源与数据

使用 Python 3.11 独立环境；`requirements.lock` 是本轮已验证环境的完整版本快照。新环境可用 `uv venv .tmp/phase2/venv --python 3.11` 建立，再用以下命令安装。已有本轮环境可直接复用。

```powershell
uv --cache-dir .tmp/phase2/uv-cache pip install --python .tmp/phase2/venv/Scripts/python.exe -r tools/model-pipeline/ppyoloe/requirements.lock
$python = (Resolve-Path .tmp/phase2/venv/Scripts/python.exe).Path
```

按 `reports/evaluation/2026-09-11-ppyoloe/sources.lock.json` 中的 URL 和 filename 下载三个公开文件到 `.tmp/phase2/downloads/`，再校验。将源码 ZIP 解压到 `.tmp/phase2/upstream/`，从 COCO ZIP 解出 `instances_val2017.json` 到 `.tmp/phase2/dataset/`。图片下载 URL 和许可分别见归档 `dataset/images.lock.json`，保存到 `.tmp/phase2/dataset/images/`。COCO 图片许可逐图不同，不随 SDK 的 Apache-2.0 许可再分发。

```powershell
& $python tools/model-pipeline/ppyoloe/sources.py --lock reports/evaluation/2026-09-11-ppyoloe/sources.lock.json --downloads-dir .tmp/phase2/downloads
if ($LASTEXITCODE -ne 0) { throw "来源校验失败" }
& $python tools/model-pipeline/evaluation/prepare_subset.py --annotations .tmp/phase2/dataset/instances_val2017.json --images-dir .tmp/phase2/dataset/images --output-dir .tmp/phase2/dataset-rebuilt --expected-selection reports/evaluation/2026-09-11-ppyoloe/dataset/selection.json --expected-images-lock reports/evaluation/2026-09-11-ppyoloe/dataset/images.lock.json
if ($LASTEXITCODE -ne 0) { throw "数据子集校验失败" }
```

## 导出与本地清单

导出入口在运行 Paddle 前再次校验权重和两个关键配置文件。完整源码归档的哈希由上一步校验；不要修改解压后的源码。Paddle 的临时转换缓存落在显式目录。

```powershell
& $python tools/model-pipeline/ppyoloe/export.py --variant s --upstream .tmp/phase2/upstream/PaddleDetection-b25522a0f4bde8c80603f3ba5e3472059972e3b5 --weights .tmp/phase2/downloads/ppyoloe-plus-s.pdparams --output-dir .tmp/phase2/exported --temp-dir .tmp/phase2/paddle-cache --onnx-output .tmp/phase2/ppyoloe-plus-s-fp32.onnx
if ($LASTEXITCODE -ne 0) { throw "导出失败" }
& $python tools/model-pipeline/ppyoloe/fix_onnx.py --input .tmp/phase2/ppyoloe-plus-s-fp32.onnx --output .tmp/phase2/ppyoloe-plus-s-candidate.onnx --report .tmp/phase2/ppyoloe-fix.json
if ($LASTEXITCODE -ne 0) { throw "定向修复失败" }
& $python tools/model-pipeline/ppyoloe/build_manifest.py --model .tmp/phase2/ppyoloe-plus-s-candidate.onnx --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --output .tmp/phase2/ppyoloe-runtime-manifest.json
```

## 质量和参考核验

```powershell
& $python tools/model-pipeline/ppyoloe/inference.py --model-kind ppyoloe --model .tmp/phase2/ppyoloe-plus-s-candidate.onnx --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --images-dir .tmp/phase2/dataset/images --predictions .tmp/phase2/results/ppyoloe-predictions.json --report .tmp/phase2/results/ppyoloe-runtime.json
& $python tools/model-pipeline/ppyoloe/paddle_reference.py --exported-dir .tmp/phase2/exported/ppyoloe_plus_crn_s_80e_coco --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --images-dir .tmp/phase2/dataset/images --predictions .tmp/phase2/results/paddle-predictions.json --report .tmp/phase2/results/paddle-reference.json --onnx-predictions .tmp/phase2/results/ppyoloe-predictions.json
```

`--model-kind ppyoloe-pillow` 使用 SDK 对应的 Pillow 预处理。PicoDet 基线使用 `--model-kind picodet --model models/pp-detection/picodet-l-320-fp32.onnx`，并选取不同输出文件名。推理工具返回官方 COCOeval 和原始预测，不能用同模型自比较代替 Paddle 核验。

已有任意 COCO 预测时，可单独运行：

```powershell
$env:PYTHONPATH = (Resolve-Path tools/model-pipeline).Path
& $python -m evaluation.cli coco --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --predictions .tmp/phase2/results/ppyoloe-predictions.json --image-ids reports/evaluation/2026-09-11-ppyoloe/dataset/image-ids.json --output .tmp/phase2/results/ppyoloe-coco.json
```

浏览器使用 [候选接入指南](../../../examples/ppyoloe-candidate/README.md)中的正式 runner。浏览器 JSON 的 `predictions` 数组可抽取后交给同一 COCOeval 入口。WASM/WebGPU 必须顺序运行；首张与后续图片的耗时分开统计。

## M/L/X 精度评估

完整口径、对比结果和证据见 [M/L/X 三精度桌面报告](../../../reports/evaluation/2026-09-14-ppyoloe-mlx-precision/README.md)。

`float16_models.py` 的 `--profile ppyoloe-s|ppyoloe-m|ppyoloe-l|ppyoloe-x` 分别绑定正式 FP32 清单的 SHA-256，保留 ReduceMean 和默认敏感算子为 FP32。旧的 `--profile ppyoloe` 仍指向 S。W8A32 使用现有 `weight_only.py`，卷积权重按通道 INT8 存储，激活和卷积计算保持 FP32。

```powershell
& $python tools/model-pipeline/float16_models.py --profile ppyoloe-m --source .tmp/ppyoloe-plus-m-fixed.onnx --output .tmp/ppyoloe-plus-m-fp16.onnx
& $python reports/evaluation/2026-09-14-ppyoloe-mlx-precision/evaluate.py prepare
& $python reports/evaluation/2026-09-14-ppyoloe-mlx-precision/evaluate.py python
node reports/evaluation/2026-09-14-ppyoloe-mlx-precision/browser.mjs
& $python reports/evaluation/2026-09-14-ppyoloe-mlx-precision/evaluate.py archive
& $python reports/evaluation/2026-09-14-ppyoloe-mlx-precision/summarize.py
```

评估目录的本地清单全部为 labs；模型转换成功和体积缩小不直接代表可稳定发布。报告同时记录 IoU≥0.99 的严格逐框门槛与 IoU≥0.5 的识别匹配口径，防止混用历史报告的两种判定。重复运行会校验并复用本轮完整产物；需要新一轮计时应保存旧证据并使用独立工作目录。评估源模型位置见 `evaluate.py` 的 `SOURCES`，与正式模型字节不一致时拒绝运行。
