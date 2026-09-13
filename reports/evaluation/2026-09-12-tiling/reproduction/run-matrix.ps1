# 一次性实验，必须在 SDK 根目录执行；不要同时运行其他推理、构建或压力测试。
$ErrorActionPreference = 'Stop'
foreach ($backend in @('webgpu', 'wasm')) {
  foreach ($modelName in @('picodet', 'ppyoloe')) {
    foreach ($variant in @('fp32', 'fp16', 'w8a32')) {
      node reports/evaluation/2026-09-12-tiling/reproduction/browser-probe.mjs $modelName $variant $backend
      if ($LASTEXITCODE -ne 0) { throw "评估失败：$modelName / $variant / $backend" }
    }
  }
}
