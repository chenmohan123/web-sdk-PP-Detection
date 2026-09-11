# PP-YOLOE+ S 640 FP32 复现

所有命令从仓库根目录执行。候选仍为 `labs`；本轮没有公开模型分发 revision，也没有发布 SDK。来源、指标和限制见 [评测报告](../../../reports/evaluation/2026-09-11-ppyoloe/README.md)。

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
& $python tools/model-pipeline/ppyoloe/export.py --upstream .tmp/phase2/upstream/PaddleDetection-b25522a0f4bde8c80603f3ba5e3472059972e3b5 --weights .tmp/phase2/downloads/ppyoloe-plus-s.pdparams --output-dir .tmp/phase2/exported --temp-dir .tmp/phase2/paddle-cache --onnx-output .tmp/phase2/ppyoloe-plus-s-fp32.onnx
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
& $python tools/model-pipeline/evaluation/cli.py coco --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --predictions .tmp/phase2/results/ppyoloe-predictions.json --image-ids reports/evaluation/2026-09-11-ppyoloe/dataset/image-ids.json --output .tmp/phase2/results/ppyoloe-coco.json
```

浏览器使用 [候选接入指南](../../../examples/ppyoloe-candidate/README.md)中的正式 runner。浏览器 JSON 的 `predictions` 数组可抽取后交给同一 COCOeval 入口。WASM/WebGPU 必须顺序运行；首张与后续图片的耗时分开统计。
