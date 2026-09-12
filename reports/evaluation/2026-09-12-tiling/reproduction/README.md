# 一次性切片实验复现

这些脚本用于 2026-09-12 的可行性评估，没有接入 SDK 或 Demo，也不代表最终产品 API。

在 SDK 根目录运行。需要 Node 22+、仓库 pnpm 依赖、Playwright Chromium，以及包含 numpy、Pillow、pycocotools 的 Python。当前环境使用 `.tmp/phase2/venv/Scripts/python.exe`。原始实验 Chromium 为 153.0.8010.12，ORT Web 为 1.27.0；SDK 基线为 `152b176327bf9a68a445818c622e985678ea1c51`（0.3.2）。

先按 [PP-YOLOE 数据集准备指南](../../../../tools/model-pipeline/ppyoloe/README.md)恢复固定 64 张图片至 `.tmp/phase2/dataset/images`，标注与哈希锁位于 `reports/evaluation/2026-09-11-ppyoloe/dataset`。不要换图、重编码或改动标注。运行 `pnpm build` 生成正式 bundle。`prepare.py` 会核验已有模型；缺失模型从清单固定的 ModelScope 来源获取并检查字节数和 SHA256。仓库内 PicoDet FP32 如仍为 Git LFS 指针，先恢复模型本体。下载公开模型不需要令牌。

```powershell
$env:PYTHONIOENCODING = 'utf-8'
$env:PLAYWRIGHT_BROWSERS_PATH = 'F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers'
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling/reproduction/prepare.py
node reports/evaluation/2026-09-12-tiling/reproduction/check-geometry.mjs
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling/reproduction/summarize.py --check
node reports/evaluation/2026-09-12-tiling/reproduction/browser-probe.mjs picodet fp32 webgpu 2
& reports/evaluation/2026-09-12-tiling/reproduction/run-matrix.ps1
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling/reproduction/summarize.py
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling/reproduction/figures.py
```

其他机器应调整 Python 与浏览器路径。Windows 系统字体 `msyh.ttc` 仅用于生成中文图片，其他系统需在 `figures.py` 配置等价字体。

完整矩阵为两模型 × 三精度 × 两后端，共 12 个串行组合。每组合 64 图，每图整图一次与四片各一次，预热图单独运行、排除在统计外。末尾数量参数仅用于预检，输出独立文件，不能混入完整汇总。单个组合失败会停止矩阵，同时保留失败输出；排查后显式重跑该组合，再继续余下组合。

浏览器绑定 `127.0.0.1` 随机端口，只暴露明确列出的 SDK、模型、ORT 和样本资源。关闭回退、缓存，使用 main 执行模式、WASM 线程数 1。WebGPU 请求物理适配器并检查身份；ORT 内部仍可能把 shape 等算子分配给 CPU，不能据此声称所有算子均在 GPU。

`browser/*.json.gz` 保存 SDK 身份、环境、警告、预热、逐图耗时，以及整图、切片原始框、坐标映射和合并结果。`summary.json` 保存 36 行指标和原始文件哈希；`matches.json.gz` 保存逐图 COCO 一对一匹配与 crowd 忽略结果。大体积原始输出只保留本地，不纳入 Git。重新运行会更新本机 `inputs.json` 和输出，核对原始证据时不要先运行 `prepare.py` 覆盖输入锁。

时间口径：模型读取、初始化和预热不计入逐图处理；JPEG 字节在解码计时前读取。整图耗时为一次解码＋一次检测；切片耗时为一次解码＋RGBA 裁切＋四次检测＋映射＋去重；组合为一次解码＋五次检测＋裁切、映射和组合去重。三模式成本来自同一组推理结果重建，不是三套独立生产调度器或稳定压测结果。

质量口径：AP 使用官方 COCOeval 的 bbox 评估、IoU 0.50:0.05:0.95、默认 maxDets；固定阈值命中使用 score ≥ 0.5、IoU ≥ 0.5、每图每类最多 100 框，按官方同类一对一匹配及 crowd 忽略处理。误检包括错误类别、定位不符、重复和标注未覆盖等情况，不能把 FP 都解释成凭空识别。重复误检定义为未匹配框与已经匹配的同类别普通 GT 的 IoU ≥ 0.5。小目标按标注 area < 1024，本数据没有 area 恰为 1024 的实例。

案例选择固定为 FP32 WebGPU：分别选净小目标收益最高、丢失大目标最多、误检增量最高的图片，同分按图片 ID 升序。案例保留来源和许可链接，呈现收益与失败，不用于重新调参。
