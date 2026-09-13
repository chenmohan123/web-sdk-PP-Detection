# 一次性实验：需先配置 PLAYWRIGHT_BROWSERS_PATH，组合之间不并行。
$ErrorActionPreference = 'Stop'
foreach ($backend in @('webgpu', 'wasm')) {
  foreach ($modelName in @('picodet', 'ppyoloe')) {
    $variantList = if ($backend -eq 'webgpu') { @('fp32', 'fp16', 'w8a32') } else { @('fp32') }
    foreach ($variant in $variantList) {
      node reports/evaluation/2026-09-12-tiling-refinement/reproduction/run-holdout.mjs $modelName $variant $backend
      if ($LASTEXITCODE -ne 0) { throw "评估失败：$modelName / $variant / $backend" }
    }
  }
}
