# 在仓库根目录执行；每轮串行，避免并发任务影响性能。
param(
  [Parameter(Mandatory=$true)][string]$BaselineBundle,
  [Parameter(Mandatory=$true)][string]$CandidateBundle,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputDirectory) { throw '请使用新的输出目录，保留已有证据。' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$models = @(
  @{ Name='ppyoloe'; Model='.tmp/phase2/ppyoloe-plus-s-candidate.onnx'; Manifest='models/ppyoloe-plus-s-640/manifest.json'; Backend='webgpu'; Rounds=3 },
  @{ Name='picodet'; Model='models/pp-detection/picodet-l-320-fp32.onnx'; Manifest='models/pp-detection/manifest.json'; Backend='webgpu'; Rounds=1 },
  @{ Name='picodet'; Model='models/pp-detection/picodet-l-320-fp32.onnx'; Manifest='models/pp-detection/manifest.json'; Backend='wasm'; Rounds=1 },
  @{ Name='ppyoloe'; Model='.tmp/phase2/ppyoloe-plus-s-candidate.onnx'; Manifest='models/ppyoloe-plus-s-640/manifest.json'; Backend='wasm'; Rounds=1 }
)
foreach ($model in $models) {
  for ($round=1; $round -le $model.Rounds; $round++) {
    $variants = if ($round % 2 -eq 0) { @('candidate','baseline') } else { @('baseline','candidate') }
    foreach ($variant in $variants) {
      $bundle = if ($variant -eq 'baseline') { $BaselineBundle } else { $CandidateBundle }
      $output = Join-Path $OutputDirectory "$($model.Name)-$($model.Backend)-$variant-$round.json"
      node tools/model-pipeline/browser/evaluation-runner.mjs --model $model.Model --manifest $model.Manifest --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --image-root .tmp/phase2/dataset/images --backend $model.Backend --sdk-bundle $bundle --output $output
      if ($LASTEXITCODE -ne 0) { throw "评测失败：$output" }
    }
  }
}
