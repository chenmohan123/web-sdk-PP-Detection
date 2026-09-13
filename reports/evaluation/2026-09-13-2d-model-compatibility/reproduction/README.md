# SOD 转换复现

所有命令从 SDK 仓库根目录执行。以下流程使用 Python 3.11、固定 PaddleDetection commit、官方 SOD L COCO 权重和已提交的 64 图 COCO 子集标注。下载、模型和中间文件保存在 `.tmp/`，不进入 Git 或 npm。图片许可逐项见 [图片锁文件](../../2026-09-11-ppyoloe/dataset/images.lock.json)。

## 环境与输入

安装 uv 后建立环境；已有本轮环境可以复用。Python 完整依赖版本见 [requirements.lock](../../../../tools/model-pipeline/ppyoloe/requirements.lock)，Node 依赖使用仓库锁文件。每条命令失败后停止，不使用失败阶段的旧输出继续汇总。

```powershell
uv venv .tmp/phase2/venv --python 3.11
uv --cache-dir .tmp/phase2/uv-cache pip install --python .tmp/phase2/venv/Scripts/python.exe -r tools/model-pipeline/ppyoloe/requirements.lock
pnpm install --frozen-lockfile
$py = '.tmp/phase2/venv/Scripts/python.exe'
$repro = 'reports/evaluation/2026-09-13-2d-model-compatibility/reproduction'
$work = '.tmp/sod-20260913'
$annotations = 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
$images = '.tmp/phase2/dataset/images'
function Assert-Step {
    if ($LASTEXITCODE -ne 0) { throw "上一条命令失败：$LASTEXITCODE" }
}
& $py -X utf8 "$repro/prepare_inputs.py"
Assert-Step
```

`prepare_inputs.py` 下载锁定的源码归档、SOD 权重和 64 张图片，并逐项校验字节数、SHA-256 与源码解压内容。已有不同字节的文件会报错并保留，不会覆盖。使用 `--verify-only` 可只校验。权重约 351 MB，源码归档约 46 MB，不需要下载完整 COCO 数据集。已提交的 `annotations.json` 就是本轮子集标注。

## 官方导出与图准备

`export_sod.py` 只调用官方 Paddle 导出，不调用 Paddle2ONNX；后者单独执行。脚本会再次校验源码和权重，将转换缓存重定向到 `.tmp/`，不修改上游源码。

```powershell
& $py -X utf8 "$repro/export_sod.py" *> "$work/export.log"
Assert-Step
& .tmp/phase2/venv/Scripts/paddle2onnx.exe --model_dir "$work/exported/ppyoloe_plus_sod_crn_l_80e_coco" --model_filename model.pdmodel --params_filename model.pdiparams --opset_version 11 --save_file "$work/ppyoloe-sod-l-640-raw.onnx" *> "$work/paddle2onnx.log"
Assert-Step
& $py -X utf8 "$repro/inspect_raw.py"
Assert-Step
& $py -X utf8 "$repro/prepare_sod.py" --input "$work/ppyoloe-sod-l-640-raw.onnx" --output "$work/ppyoloe-sod-l-640-candidate.onnx" --report "$work/preparation.json"
Assert-Step
& $py -X utf8 "$repro/prepare_manifest.py"
Assert-Step
```

`inspect_raw.py` 将原图检查与会话创建结果写入 `raw-inspection.json`，包括本次观察到的形状推断错误。`prepare_sod.py` 只接受本次原始 ONNX 的 SHA-256，再检查 NMS 拓扑并修正两个 Squeeze 轴、固定单输入。如果另一环境导出的原图摘要不同，停止并重新检查来源与图结构，不能绕过校验。`prepare_manifest.py` 生成仅供本地实验的 labs 清单及标注顺序中前 8 张图片的浏览器子集。

## Python 与浏览器参考

```powershell
& $py -X utf8 tools/model-pipeline/ppyoloe/inference.py --model-kind ppyoloe --model "$work/ppyoloe-sod-l-640-candidate.onnx" --annotations $annotations --images-dir $images --predictions "$work/onnx-predictions.json" --report "$work/onnx-runtime.json"
Assert-Step
& $py -X utf8 tools/model-pipeline/ppyoloe/paddle_reference.py --exported-dir "$work/exported/ppyoloe_plus_sod_crn_l_80e_coco" --annotations $annotations --images-dir $images --predictions "$work/paddle-predictions.json" --report "$work/paddle-reference.json" --onnx-predictions "$work/onnx-predictions.json"
Assert-Step
& $py -X utf8 tools/model-pipeline/ppyoloe/inference.py --model-kind ppyoloe-pillow --model "$work/ppyoloe-sod-l-640-candidate.onnx" --annotations $annotations --images-dir $images --predictions "$work/pillow-predictions.json" --report "$work/pillow-runtime.json"
Assert-Step
pnpm build *> "$work/build.log"
Assert-Step
$env:PLAYWRIGHT_BROWSERS_PATH = '.tmp/dependencies-compatible-browsers'
pnpm exec playwright install chromium
Assert-Step
foreach ($backend in @('wasm', 'webgpu')) {
    node tools/model-pipeline/browser/evaluation-runner.mjs --model "$work/ppyoloe-sod-l-640-candidate.onnx" --manifest "$work/candidate-manifest.json" --annotations "$work/browser-annotations.json" --image-root $images --backend $backend --expected-images 8 --output "$work/browser-$backend.json"
    Assert-Step
}
```

两后端顺序运行，避免互相影响计时。WebGPU 需要真实硬件适配器；不支持或运行失败时保存失败证据并停止，本轮成功汇总不能用于伪造缺失后端结果。Paddle 对比使用 OpenCV INTER_CUBIC；浏览器对比使用 Python ONNX Runtime + Pillow BICUBIC。8 图 smoke 不代替 Worker、生命周期和移动端验收。

## 汇总与校验

```powershell
& $py -X utf8 "$repro/summarize.py"
Assert-Step
& $py -X utf8 "$repro/verify_evidence.py"
Assert-Step
```

`summarize.py` 读取本轮中间文件，重新计算逐框对比并更新本目录的报告与压缩证据。只有两后端均通过且高置信度框没有未匹配项时才生成成功汇总；这些文件会成为工作区改动，需审阅后提交。`verify_evidence.py` 只读取证据，校验所有 JSON、压缩文件摘要、上游快照和 SOD 状态一致性，不需要模型本体。
