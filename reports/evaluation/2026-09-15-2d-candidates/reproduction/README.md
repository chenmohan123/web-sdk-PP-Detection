# 本批次复现

以下命令从 SDK 仓库根目录执行。先复算已归档证据；需要重新运行模型时再准备本地环境。脚本用于固定批次评估，会严格核对模型和 SDK 摘要；不同环境产生不同产物时应另建评估批次，不覆盖此处的历史记录。

## 只复算归档

Python 3.11，依赖见仓库 `tools/model-pipeline/evaluation/requirements.txt`。本机复用已有环境：

```powershell
$candidatePython = 'F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe'
$candidateScripts = 'reports/evaluation/2026-09-15-2d-candidates/reproduction'
$env:PYTHONIOENCODING = 'utf-8'
& $candidatePython "$candidateScripts/summarize.py"
if ($LASTEXITCODE -ne 0) { throw '归档复算失败' }
```

此命令校验29份gzip证据压缩前后的大小和SHA-256，重新计算18组AP、三轮热推理中位数和阈值以上框匹配，再与 `summary.json` 比较；不会下载权重、启动浏览器或改写归档。它不能仅凭预测文件重新证明模型确实产生了这些预测，实际运行方法见下文。

## 环境与输入准备

本次使用Windows、Python3.11.15、Paddle2.6.2、Paddle2ONNX1.3.1、ONNX1.16.2、ORT Python1.20.1、NumPy1.26.4、OpenCV4.11.0.86、Pillow11.3.0；导出依赖复用 `tools/model-pipeline/ppyoloe/requirements.lock`。导出脚本目前调用Windows的 `paddle2onnx.exe`。

SDK基线为 `025e207ff0a6a3a4e07f0a4c5b02834969b199ce`，使用仓库锁文件安装依赖并构建SDK，版本0.4.0，ORT Web1.27.0。浏览器脚本要求 `packages/sdk/dist/browser-global.js` 的SHA-256为 `c2b6a9733416571c77c8dc48fa68028251e5d8cccb201047c8387bf9433e1189`。本机Chromium153.0.8010.12的缓存如下，其他机器应安装锁文件对应的Playwright Chromium并记录实际版本。

```powershell
$candidateCache = 'F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2'
$candidateWork = '.tmp/candidate-2d-20260915-reproduction'
$candidateImages = "$candidateCache/dataset/images"
$env:PLAYWRIGHT_BROWSERS_PATH = 'F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers'
```

准备以下本地文件：

- 源码ZIP放到 `$candidateCache/downloads/paddledetection.zip`，按原顶层目录解压到 `$candidateCache/upstream/`。下载地址和摘要见 [sources.lock.json](../sources.lock.json)，脚本会逐字节核对所有解压文件。
- 图集使用 `reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json` 中64张COCO val2017图片，放到 `$candidateImages`；该历史批次的数据集说明记录其来源。浏览器报告记录每图摘要，本批汇总要求固定图集摘要，不能替换成同名其他图片。
- PicoDet-XS/S-320 FP32分别放到 `.tmp/picodet-series/picodet-xs-320-webgpu.onnx`、`.tmp/picodet-series/picodet-s-320-webgpu.onnx`。文件名中的webgpu不限制运行后端。下载地址、固定revision和摘要取自 `models/pp-detection/picodet-{xs,s}-320/1.0.1/manifest.json` 的FP32来源；XS的SHA为 `54417c113c07d4507af8f92027032a17a315a25014ee57922d18a2fd504797d3`，S为 `84cd653b3615f63f6e8d478d8c590578a6c9b0608d597948799e599e5c3ad1ab`。

## 导出、错误重现和修正

按顺序执行，每步失败即停。`prepare_sources.py`只下载官方Tiny权重，并更新来源快照；固定摘要不符时拒绝继续。

```powershell
& $candidatePython "$candidateScripts/prepare_sources.py" --cache $candidateCache --work $candidateWork
if ($LASTEXITCODE -ne 0) { throw '来源核验失败' }
& $candidatePython "$candidateScripts/export_tiny.py" --cache $candidateCache --work $candidateWork *> "$candidateWork/export.log"
if ($LASTEXITCODE -ne 0) { throw '导出失败' }
& $candidatePython "$candidateScripts/inspect_raw.py" --work $candidateWork --images $candidateImages
if ($LASTEXITCODE -ne 0) { throw '原图检查或故障复现失败' }
& $candidatePython "$candidateScripts/prepare_tiny.py" --work $candidateWork
if ($LASTEXITCODE -ne 0) { throw '图修正失败' }
& $candidatePython "$candidateScripts/reference_tiny.py" --work $candidateWork --images $candidateImages *> "$candidateWork/reference.log"
if ($LASTEXITCODE -ne 0) { throw '64图参考验证失败' }
```

`inspect_raw.py`核对已归档原图元数据，并要求首图270244触发 `Gather.12` 轴错误；只有成功复现这个预期错误才返回0。诊断写入本地 `raw-diagnostic.json`。归档的 `reference-raw-failure.log.gz`是首次实验中旧版参考脚本直接调用原图时的历史失败日志，当前修正后的参考脚本不会再产生该日志；不要用新的诊断冒充原日志。

`prepare_tiny.py`只对固定SHA原图的两个Squeeze添加 `[0,2]` 轴，再固定单图输入和两个辅助常量，生成候选manifest和本地labs产物。`reference_tiny.py`比较Paddle、NMS修正三输入图和最终单输入图；其中名为 `onnx-pillow` 的参考只采用Pillow缩放且不处理ICC，不能单独作为浏览器后端错误判据。

## 三轮浏览器与生命周期

运行期间避免同时执行其他推理或构建。此机器必须有可用物理WebGPU适配器，脚本不接受软件适配器或SDK回退作为GPU通过证据。

```powershell
node "$candidateScripts/browser.mjs" $candidateWork $candidateImages
if ($LASTEXITCODE -ne 0) { throw '三轮浏览器评测失败' }
node "$candidateScripts/lifecycle.mjs" $candidateWork $candidateImages
if ($LASTEXITCODE -ne 0) { throw '生命周期验证失败' }
node "$candidateScripts/capture_inputs.mjs" $candidateWork $candidateImages
if ($LASTEXITCODE -ne 0) { throw '实际输入捕获失败' }
& $candidatePython "$candidateScripts/reference_captured.py" --work $candidateWork --images $candidateImages
if ($LASTEXITCODE -ne 0) { throw '相同输入参考验证失败' }
```

`browser.mjs`按三模型×两后端×三轮串行执行，默认跑全部三轮；可传第三个参数2或3从指定轮次继续，必须保留此前成功的完整轮次。主计时来自未插桩的这些轮次。

生命周期脚本覆盖两后端×main/Worker、两图检测、预取消、恢复、dispose及重复dispose，不覆盖进行中取消竞态。输入捕获脚本在真实ORT调用前旁路保存64份小端float32张量，仍调用原 `session.run`，并断言预测与首轮WASM结果完全相同。此步骤不参与计时；张量包含图片信息，仅保存在本地，不提交。Python读取并核验张量摘要后复算AP和框匹配，单独记录Pillow输入差异与ICC配置存在情况。

## 保存新一轮结果

`summarize.py --archive <工作目录>`会重写本报告的证据索引、gzip和summary，只用于维护原批次归档，要求全部29份文件（包含首次历史失败日志）齐全。重新实验应保留到新的报告目录，记录新日期、环境、输入和SDK摘要，审核后再建立新的索引；不要复制旧失败日志伪装成新实验结果，也不要要求跨设备耗时逐字节等于本批次。

本批次原始工作目录为 `.tmp/candidate-2d-20260915/`；归档命令为：

```powershell
& $candidatePython "$candidateScripts/summarize.py" --archive .tmp/candidate-2d-20260915
if ($LASTEXITCODE -ne 0) { throw '归档失败' }
& $candidatePython "$candidateScripts/summarize.py"
if ($LASTEXITCODE -ne 0) { throw '归档复算失败' }
```
