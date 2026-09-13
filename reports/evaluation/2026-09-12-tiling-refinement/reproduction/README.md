# 第二轮实验复现

本目录为一次性实验，不提供 SDK 产品接口。所有命令从 `web-sdk-PP-Detection` 根目录运行；使用现有 Node/pnpm、Python 3.11、numpy/Pillow/pycocotools 和 Playwright 环境。旧实验见 `../2026-09-12-tiling`，原始压缩输出应仍存在本地。

## 开发集与冻结

`offline.mjs` 校验上一轮原始文件哈希，复现原组合结果，再应用有限候选。`choose_strategy.py` 通过官方 COCOeval 比较并选择策略。`diagnose_anchors.py` 检查弱整图框的压制机制。首次候选文件名曾误用 `select.py`，遮蔽 Python 标准库；修正后的正式复现文件名为 `choose_strategy.py`。

首次三个候选的协议、选择和原代码保存在 `development-v1`，这些文件只作历史证据，不在该目录直接运行（相对依赖路径对应原 `reproduction` 位置）。最终候选增加的原因、顺序和门槛在 `protocol.md` 中说明；没有独立集结果参与该调整。

```powershell
$env:PYTHONIOENCODING = 'utf-8'
node reports/evaluation/2026-09-12-tiling-refinement/reproduction/offline.mjs --check
node reports/evaluation/2026-09-12-tiling-refinement/reproduction/offline.mjs
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/diagnose_anchors.py
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/choose_strategy.py
```

`selection.json` 保存最终冻结时间、策略哈希及完整门槛结果。重跑选择会更新文件时间和哈希；核验既有实验时不要先覆盖它。

## 独立集

`fetch_validation.py` 使用 VisDrone 官方说明所关联、Ultralytics 配置明确给出的公开镜像下载验证集，并保存来源文件、字节数和 SHA256。数据仅落在 `.tmp/tiling-refinement`。原始来源是 VisDrone/AISKYEYE，不能把数据许可解释为镜像代码的 AGPL 或 SDK 的 Apache-2.0。

`prepare_holdout.py` 只根据固定种子、尺寸和标注选 32 张图，不读取预测。首桶 16 张兼有小/大目标，次桶 16 张含小目标；优先限制每个文件名前缀组最多两张，排序和补足规则锁定在代码。实际全部组均不超过两张。保留原 JPEG 字节，没有缩放图片来制造高分辨率。

本实验将 pedestrian/people 合为 COCO person，car/van 合为 car，bicycle、truck、bus、motor 分别映射到 bicycle、truck、bus、motorcycle。仅评估这六类。tricycle、awning-tricycle、others、score=0 记录作为忽略区域；普通 GT 若与忽略区的交集占自身面积超过 50%，先排除。每个忽略区为六类各建立一条 crowd bbox，COCOeval 根据预测框交集比例忽略相关检测，普通 GT 匹配优先。该口径是本实验的六类适配，不是原始十类别 VisDrone 官方 AP，也不能与旧 COCO 子集 AP 横向排名。

```powershell
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/fetch_validation.py
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/prepare_holdout.py
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/build_probe.py
$env:PLAYWRIGHT_BROWSERS_PATH = 'F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/dependencies-compatible-browsers'
node reports/evaluation/2026-09-12-tiling-refinement/reproduction/run-holdout.mjs picodet fp32 webgpu 2
```

`build_probe.py` 复用第一轮浏览器探针生成 `run-holdout.mjs`，每项源文本替换必须唯一，否则拒绝生成；正式运行前校验冻结策略、输入模型、图片、SDK 与协议。生成的 `tiling.mjs` 与第一轮逐字节相同。浏览器通过正式 SDK 公共 API 读取原始 RGBA；没有改动旧探针。

完整矩阵必须串行运行：六个变体 WebGPU、两模型 FP32 WASM。每项去掉末尾数量参数即执行完整 32 图；第一次整图和四片预热不计入统计。运行脚本见 `run-matrix.ps1`，随后执行：

```powershell
& reports/evaluation/2026-09-12-tiling-refinement/reproduction/run-matrix.ps1
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/evaluate_holdout.py
.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-12-tiling-refinement/reproduction/render_report.py
```

整图、原组合、冻结候选来自同一组五次推理，分别计算合并成本。耗时包括一次解码、裁切、SDK 检测、坐标映射与各自合并；不含 JPEG 字节读取、模型下载/读取、初始化和预热。原始计时中各模式复用了同一组推理，不能声称是独立调度实现的稳定性能。GPU 记录实际适配器，ORT 内部可能保留 CPU 算子，SDK 禁止整次后端回退。

`evaluate_holdout.py` 核对八个组合全部 32 图和身份后输出 24 行指标；原始模型输出保留全部 80 类，评估阶段只纳入锁定的六类，并记录范围外预测数量。AP 使用官方 pycocotools 默认 maxDets；匹配使用 score ≥ 0.5、IoU ≥ 0.5。密集图的每类 100 检测上限是本实验口径的一部分，不能当作无限检测召回率。

浏览器输出、逐图匹配和照片叠框图保留本地；提交轻量报告、来源/样本锁、哈希索引、脚本与不含照片的统计图。
