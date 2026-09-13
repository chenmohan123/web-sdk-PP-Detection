param([Parameter(Mandatory = $true)][string]$SdkCache)
$ErrorActionPreference = 'Stop'
$cache = (Resolve-Path -LiteralPath $SdkCache).Path
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $root
$py = Join-Path $cache '.tmp/phase2/venv/Scripts/python.exe'
$paddle2onnx = Join-Path $cache '.tmp/phase2/venv/Scripts/paddle2onnx.exe'
$sodModel = Join-Path $cache '.tmp/sod-20260913/ppyoloe-sod-l-640-candidate.onnx'
$images = Join-Path $cache '.tmp/phase2/dataset/images'
$report = 'reports/evaluation/2026-09-13-sod-comparison'
$work = 'work/sod-comparison'
$annotations = 'reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json'
function Assert-Step {
    if ($LASTEXITCODE -ne 0) { throw "上一阶段失败：$LASTEXITCODE" }
}
New-Item -ItemType Directory -Path $work -Force | Out-Null
if (-not (Test-Path "$work/ppyoloe_plus_crn_l_80e_coco.pdparams")) {
    curl.exe --fail --location --retry 2 --output "$work/ppyoloe_plus_crn_l_80e_coco.pdparams" 'https://paddledet.bj.bcebos.com/models/ppyoloe_plus_crn_l_80e_coco.pdparams'
    Assert-Step
}
& $py -X utf8 "$report/export_reference.py" --cache-root $cache *> "$work/export.log"
Assert-Step
& $paddle2onnx --model_dir "$work/exported/ppyoloe_plus_crn_l_80e_coco" --model_filename model.pdmodel --params_filename model.pdiparams --opset_version 11 --save_file "$work/ppyoloe-plus-l-raw.onnx" *> "$work/paddle2onnx.log"
Assert-Step
& $py -X utf8 tools/model-pipeline/ppyoloe/fix_onnx.py --input "$work/ppyoloe-plus-l-raw.onnx" --output "$work/ppyoloe-plus-l-candidate.onnx" --report "$work/preparation.json"
Assert-Step
& $py -X utf8 "$report/prepare_evaluation.py" --cache-root $cache
Assert-Step
$models = @{ ordinary = "$work/ppyoloe-plus-l-candidate.onnx"; sod = $sodModel }
foreach ($kind in @('opencv', 'pillow')) {
    $modelKind = if ($kind -eq 'opencv') { 'ppyoloe' } else { 'ppyoloe-pillow' }
    foreach ($name in @('ordinary', 'sod')) {
        & $py -X utf8 tools/model-pipeline/ppyoloe/inference.py --model-kind $modelKind --model $models[$name] --annotations $annotations --images-dir $images --predictions "$work/$name-$kind-predictions.json" --report "$work/$name-$kind-runtime.json"
        Assert-Step
    }
}
& $py -X utf8 tools/model-pipeline/ppyoloe/paddle_reference.py --exported-dir "$work/exported/ppyoloe_plus_crn_l_80e_coco" --annotations $annotations --images-dir $images --predictions "$work/ordinary-paddle-predictions.json" --report "$work/ordinary-paddle-reference.json" --onnx-predictions "$work/ordinary-opencv-predictions.json" *> "$work/paddle-reference.log"
Assert-Step
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $cache '.tmp/dependencies-compatible-browsers'
foreach ($backend in @('webgpu', 'wasm')) {
    $browserAnnotations = if ($backend -eq 'webgpu') { "$work/browser-annotations-64.json" } else { "$work/browser-annotations.json" }
    $count = if ($backend -eq 'webgpu') { 64 } else { 8 }
    foreach ($name in @('ordinary', 'sod')) {
        node tools/model-pipeline/browser/evaluation-runner.mjs --model $models[$name] --manifest "$work/$name-manifest.json" --annotations $browserAnnotations --image-root "$work/images-png" --backend $backend --expected-images $count --output "$work/$name-$backend.json" *> "$work/$name-$backend.log"
        Assert-Step
    }
}
& $py -X utf8 "$report/summarize.py"
Assert-Step
& $py -X utf8 "$report/summarize.py" --verify-only
Assert-Step
