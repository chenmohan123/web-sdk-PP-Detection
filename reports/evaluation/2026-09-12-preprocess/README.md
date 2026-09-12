# PP-Detection 预处理优化评测

日期：2026-09-12。结论：保持 FP32 模型与检测结果不变，合并 bicubic 三通道重复运算，并将 8 位像素归一化改为每次调用的查表。本机 PP-YOLOE WebGPU 热端到端中位数降低 25.5%，预处理中位数降低 54.4%。这是尚未发布的 SDK 改动。

## 实现与正确性

基线为 `45cf9be`，本次实现位于 `packages/sdk/src/detection/preprocess.ts`。三个 RGB 通道共享重采样系数与索引，保留每通道的累加顺序、Pillow 整数系数、水平及垂直两次 8 位裁剪；垂直结果直接写入 CHW，归一化值按原公式预计算为 Float32。bilinear 与关闭 resize 的运算路径保持原逻辑。

每次调用独立分配输出，不复用用户持有的张量、不修改输入。中间缓冲改成 RGB 交错布局，单次缓冲大小为旧单通道的三倍；没有测量峰值内存，不能据总分配减少推断峰值下降。

- 七组独立 Pillow 11.3.0 golden 数据覆盖放大、缩小、混合缩放、单行、单列和原尺寸，另有归一化、输入/输出所有权、横向/纵向非零 letterbox 偏移断言。
- 64 张相同解码图片 × 两模型的 128 组 Float32 位模式和坐标变换完全一致，见[微基准](microbenchmark-after.json)。
- 完整检测共 12 轮、768 次图片检测；六对新旧运行的 384 组图片预测按原顺序逐项完全相等。每对的模型、清单和数据哈希相同，实际后端等于请求后端，无整次回退。SDK 构建哈希分别记录，不能仅靠内部版本号 0.3.0 区分新旧实现。
- 使用固定 COCO val2017 子集的 64 张图片、716 个标注；官方 COCOeval AP 按 0–100 为 PP-YOLOE 43.4265、PicoDet 34.2153，新旧及两后端 AP 相同。这不是全量 COCO 成绩；CPU/GPU 浮点预测之间仍可能有差异，本次相等结论仅针对同后端的新旧实现。

## 性能

Windows 11 `10.0.26200`、Intel i5-10400F、NVIDIA Blackwell 物理适配器、Chromium `153.0.8010.12`、ORT Web `1.27.0`。FP32、主线程、batch 1，WASM 单线程；正式检测开启跨域隔离，无自定义浏览器启动参数。ORT 的部分节点使用 CPU，原始警告保存在 runtime 报告。

每轮新建浏览器和检测器，顺序检测 64 张图。热统计排除首图，取后 63 张的中位数及线性插值 P90；PP-YOLOE WebGPU 三轮统计量再取中位数，运行顺序为旧/新、新/旧、旧/新。其他路径各一对。测量期间没有并行测试、构建或推理任务。

端到端是 SDK 的单图 `totalMs`，包含图片解码、预处理、推理和后处理，不含工具获取图片的 HTTP 请求或检测器初始化。模型由本机服务获取后以字节传入 SDK，初始化没有公网下载。会话复用、首次检测、会话创建分开统计。

| 路径            | 每版本轮数 | 热预处理中位数，旧 → 新 | 热端到端中位数，旧 → 新 | 端到端降幅 |
| --------------- | ---------: | ----------------------: | ----------------------: | ---------: |
| PP-YOLOE WebGPU |          3 |        52.89 → 24.09 ms |       113.59 → 84.62 ms |      25.5% |
| PicoDet WebGPU  |          1 |        32.98 → 15.11 ms |        75.28 → 58.05 ms |      22.9% |
| PP-YOLOE WASM   |          1 |        50.05 → 24.77 ms |      903.91 → 892.12 ms |       1.3% |
| PicoDet WASM    |          1 |        32.47 → 14.88 ms |      306.11 → 288.45 ms |       5.8% |

| PP-YOLOE WebGPU，三轮统计量中位数 |     旧实现 |     新实现 |
| --------------------------------- | ---------: | ---------: |
| 会话创建                          | 1145.36 ms | 1075.58 ms |
| 首张端到端                        | 1354.63 ms | 1372.33 ms |
| 热推理中位数                      |   50.83 ms |   49.21 ms |
| 热推理 P90                        |  121.25 ms |  117.36 ms |
| 热预处理 P90                      |   70.80 ms |   33.72 ms |
| 热端到端 P90                      |  178.72 ms |  146.63 ms |

优化收益主要来自预处理，不能将会话或推理的波动归因为本次实现。WASM 尤其受模型推理耗时主导：PP-YOLOE 热推理 847.07 → 860.41 ms，端到端 P90 971.31 → 1008.94 ms；本次单轮数据不足以宣称 CPU 整体稳定加速。PicoDet 的结果也只作为单轮观察。

微基准只测预处理：三轮统计量中位数，PP-YOLOE 65.00 → 28.00 ms、PicoDet 32.30 → 14.35 ms。微基准没有跨域隔离，其计时分辨率及运行负载不同，不能与正式检测或旧 FP16 报告中的耗时混算。[改动前](microbenchmark-before.json)使用两份旧算法，20% 改善目标未达成；改动后达到目标且 128 组数值一致。此目标仅用于本次实验，不作为不稳定的 CI 时间断言。

## 证据与复现

[summary.json](summary.json)保存各轮热统计、COCO 指标、输入与 SDK 哈希、精确预测比较；[runtime/](runtime/)保留每图耗时、环境、实际后端和初始化记录。预测按 JSON 内容 SHA-256 去重压缩，runtime 中包含相对路径和解压前后哈希。[source-evidence.json](source-evidence.json)记录预处理源码、构建、锁文件与 fixture 身份。

从仓库根目录执行，先按 [PP-YOLOE 指南](../../../tools/model-pipeline/ppyoloe/README.md)准备两款 FP32 ONNX、固定 64 张 JPEG、标注与 Python 评测环境。使用当前锁文件安装依赖。

完整检测需要各自构建新旧 SDK；建议把基线检出到独立临时 worktree，在其中安装锁定依赖并执行 `pnpm build`，避免切换当前工作目录：

```powershell
$baselineDirectory = Join-Path $env:TEMP 'pp-detection-preprocess-baseline'
git worktree add --detach $baselineDirectory 45cf9be
pnpm --dir $baselineDirectory install --frozen-lockfile
pnpm --dir $baselineDirectory build
pnpm build
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path .tmp/dependencies-compatible-browsers).Path
$report = 'reports/evaluation/2026-09-12-preprocess'
& "$report/reproduction/run.ps1" -BaselineBundle "$baselineDirectory/packages/sdk/dist/browser-global.js" -CandidateBundle packages/sdk/dist/browser-global.js -OutputDirectory .tmp/preprocess-reproduction
.tmp/phase2/venv/Scripts/python.exe "$report/reproduction/summarize.py" .tmp/preprocess-reproduction .tmp/preprocess-reproduction/summary
```

runner 的可选 `--sdk-bundle` 指定要评测的构建，省略时沿用默认当前构建。它记录实际文件 SHA-256；运行时依赖使用当前锁文件中的 ORT。本次只比较预处理，不用此入口混合不同 ORT 版本。

独立预处理微基准不需要 ONNX：

```powershell
node "$report/reproduction/bundle.mjs" 45cf9be .tmp/preprocess-micro
node "$report/reproduction/benchmark.mjs" .tmp/preprocess-micro .tmp/phase2/dataset/images
```

golden 文件位于 `packages/sdk/tests/fixtures/bicubic-pillow.json`。输入 RGBA 每通道公式是 `(x*53 + y*29 + channel*71 + x*y*3) % 256`，用 Pillow 11.3.0 的 `Image.frombytes("RGBA", ...).convert("RGB").resize(..., Image.Resampling.BICUBIC)` 得到独立参考；测试无需运行 Python。

## 验证边界与小米 15 清单

本次桌面验证与检查结果见 [verification.json](verification.json)。没有改变模型版本、默认来源或发布状态；本地 SDK 优化尚未推送、发布。先前小米 15 反馈覆盖已发布 FP32，尚未覆盖本次实现；也没有测量峰值内存、Worker 性能或连续视频吞吐。

后续手机验证使用本次开发构建，记录系统/浏览器版本和实际后端，然后：

- 两款模型分别用 CPU、GPU 检测同一张图，对照已发布版本的类别、置信度与检测框。
- 各重复检测五次，记录首次与后续预处理、推理、端到端耗时，避免把模型下载计入热检测。
- 检测手机竖拍高分辨率图片、横图、暗光和密集目标，确认显示、取消、重新检测与切换模型正常。
- 若验证视频或摄像头，逐帧运行数分钟并关注页面响应和系统内存提示；把结果作为新增证据记录。
