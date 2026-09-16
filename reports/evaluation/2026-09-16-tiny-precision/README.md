# PP-YOLO Tiny 精度评测（2026-09-16）

本目录记录 PP-YOLO Tiny 320 的真实 FP16/W8A32 转换、固定 64 图桌面浏览器评测和离线复算。源 FP32 使用 `models/ppyolo-tiny-320/0.1.0` 的不可变权重；SDK、输入图集、标注和 Chromium/ORT 身份均在 `inputs.lock.json` 及每条证据中锁定。

## 结论

| 精度 | 模型字节 | 体积缩减 | 最差 AP 变化（点） | 最低保留率 | 6 组门槛 | 发布判断 |
|---|---:|---:|---:|---:|---|---|
| FP32 | 4,511,117 | — | 0 | 100% | 通过 | 原 0.1.0 稳定基线 |
| FP16 | 2,357,376 | 47.743% | -0.17465 | 99.519% | 通过 | 可进入后续发布审核，当前仍为 labs |
| W8A32 | 1,573,135 | 65.128% | -0.53736 | 96.635% | 失败 | 仅保留 labs，禁止稳定目录 |

三轮去首图热推理中位数（毫秒）如下；这是本机固定环境的观测值，不代表普遍加速：

| 精度 | WASM 第1/2/3轮 | WASM 三轮中位数 | WebGPU 第1/2/3轮 | WebGPU 三轮中位数 |
|---|---:|---:|---:|---:|
| FP32 | 48.495 / 60.375 / 46.660 | 48.495 | 30.605 / 37.320 / 28.430 | 30.605 |
| FP16 | 49.670 / 83.450 / 53.005 | 53.005 | 37.130 / 37.170 / 36.250 | 37.130 |
| W8A32 | 47.220 / 50.070 / 78.240 | 50.070 | 33.920 / 32.615 / 43.725 | 33.920 |

门槛为相对同后端 FP32 的 AP 下降不超过 0.5 点、score≥0.5 且同类 IoU≥0.5 一对一保留率至少 95%。IoU≥0.99 只作严格坐标诊断，不能替代发布门槛。18 组（3 精度×2 后端×3 轮）均成功完成；W8A32 的失败来自 AP 边界，未被静默放宽。

## 产物与命令

- `prepare.py`：复用 `tools/model-pipeline/float16_models.py` 和 `weight_only.py`；Tiny 专属敏感节点及原因见 `labs.json` 与转换记录。
- `runner.mjs`：串行运行 18 组，每组 64 图、主线程、无后端回退。浏览器缓存通过 `PLAYWRIGHT_BROWSERS_PATH=F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers` 指定。
- `summarize.py`：使用 COCO AP、一对一匹配和去首图热推理中位数复算；`evidence/` 为 mtime=0 的 gzip 原始证据，`artifact-index.json` 校验压缩前后摘要。
- 主要命令：

  ```powershell
  F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-16-tiny-precision/prepare.py
  $env:PLAYWRIGHT_BROWSERS_PATH='F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers'
  node reports/evaluation/2026-09-16-tiny-precision/runner.mjs --round 1
  node reports/evaluation/2026-09-16-tiny-precision/runner.mjs --round 2
  node reports/evaluation/2026-09-16-tiny-precision/runner.mjs --round 3
  F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe -c "import sys;sys.path.insert(0,'reports/evaluation/2026-09-16-tiny-precision');import summarize;summarize.summarize(True)"
  F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe -m pytest reports/evaluation/2026-09-16-tiny-precision/test_quality.py reports/evaluation/2026-09-16-tiny-precision/test_prepare.py -q
  ```

首次运行未指定浏览器缓存时产生了启动失败证据，随后使用任务指定缓存重跑并保留该失败边界；不存在模型回退或伪造可用精度。

## 限制与风险

评测仅覆盖固定 64 图和本机 Windows 11 / Chromium 153 / ORT Web 1.27.0 / NVIDIA 物理 WebGPU，不能外推全量 COCO、手机、NPU 或其他浏览器。浏览器输出中的 ORT CPU kernel/constant-folding 警告已随原始证据保留。FP16 严格 IoU 保留率约 67.788%，所以不能宣称框坐标逐点等价；W8A32 虽体积更小且保留率达标，AP 门槛仍未通过。
