# Tiny FP16/W8A32 评测与发布实施计划

> 执行方式：使用 superpowers:subagent-driven-development，按任务实施并独立审查；主代理负责分发、集成、PR 和正式部署。

**目标：** 为 PP-YOLO Tiny 320 转换 FP16/W8A32，对照已发布 FP32 完成桌面三轮评测，发布达标变体。

**架构：** 复用现有精度转换器、Detection SDK 0.4.0、浏览器评测器与双 Hub 分发流程；权重按版本清单加载，门户只登记已发布结果。

**技术栈：** Python/ONNX/ONNX Runtime、TypeScript、Playwright、React Demo、Astro 门户。

**设计依据：** 门户 `docs/superpowers/plans/2026-09-13-pp-detection-multi-model-roadmap.md` 的后续阶段；用户已确认三精度对比、桌面优先及达标后双来源/Demo/门户发布。

## 全局约束

- 工作树：`F:/git/00_chenmohan/github/chenmohan123.github.io/.worktrees/detection-picodet-series-fp32`，分支 `codex/tiny-precision`，起点 `8c392ea7ffc196c47fa5380f5d910e32618d7849`。
- 基线 `models/ppyolo-tiny-320/0.1.0/manifest.json`，FP32 4,511,117 字节，SHA256 `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653`；本地权重 `.tmp/candidate-2d-20260915/ppyolo-tiny-320-fp32.onnx`。
- 固定64图，三精度×两后端×三轮共18组；每轮相对同后端 FP32，AP下降≤0.5个百分点，score≥0.5、同类IoU≥0.5一对一检测保留率≥95%。IoU≥0.99仅诊断；文件缩小独立计为收益，不要求加速。
- 固定输入图片/SDK/模型/清单/运行时身份并归档原始证据；不可静默回退或把子集AP标为全量COCO。质量未通过者保留labs，禁止进入稳定目录。
- Tiny新模型清单版本0.1.1，复用原FP32固定来源；不覆盖0.1.0。SDK/npm保持0.4.0，默认PicoDet-L-320/FP32/ModelScope；来源仅ModelScope、Hugging Face。
- 不修改runtime/API，不扩展手机或NPU声明。中文回复/提交/新注释，既有中英文文档同步。
- 保留用户未跟踪报告、旧分支、工作树与缓存。pnpm附加两个既定config参数。复用宿主鉴权，令牌不写入文件或输出。

### Task 1: 转换与可复算的质量门禁

**文件：** 新建 `reports/evaluation/2026-09-16-tiny-precision/`，包含 `prepare.py`、`runner.mjs`、`summarize.py`、`protocol.json`、`jobs.json`、转换记录、labs清单、18组压缩原始证据、`summary.json`、`README.md`及必要的失败边界测试；临时产物写 `.tmp/tiny-precision/`。

**接口：** `jobs.json`数组每项含key、precision、model、manifest、bytes、sha256、inputSize；precision为fp32/fp16/w8a32。`summary.json`给出每精度每后端每轮AP、常规/严格保留率、热推理中位数、环境、证据身份及逐变体可发布判断。

- [ ] 读取历史Tiny评测和PicoDet精度脚本，复用 `tools/model-pipeline/float16_models.py` 与 `weight_only.py`；按Tiny真实算子选择必要敏感节点，记录配置和原因，禁止照搬PicoDet节点名。
- [ ] 为源摘要不符、缺失轮次/后端、证据身份不符与门槛边界写有意义的失败测试；检查非有限值、输入输出契约和ONNX图。
- [ ] 转换并生成labs候选；固定协议和64图清单，CPU Python做基础有效性对照。用真实浏览器串行跑18组，禁止与其他GPU评测并行。
- [ ] 从原始结果复算AP、一对一匹配和去首图热推理中位数，逐轮作质量判断；压缩归档并校验压缩/解压摘要、SDK/模型/图片/清单身份。
- [ ] 输出三精度体积/质量/耗时表和边界；执行测试、离线复算、`git diff --check`，提交本任务。达标不等同于已发布。

### Task 2: 达标变体分发与 SDK Demo

**文件：** 新建 `reports/distribution/2026-09-16-tiny-precision/` 和 `models/ppyolo-tiny-320/0.1.1/`；更新 `apps/demo/src/model-sources.ts`、模型选择测试、`scripts/stage-pages-models.mjs`、对应测试、`sdk-manifest.yaml`、根README/英文README、模型双语文档、`models/README.md`、CHANGELOG。

**接口：** 消费Task1逐轮门禁和权重摘要；0.1.1清单只含FP32及通过的精度，int8对外映射W8A32；来源固定真实revision、bytes、SHA。

- [ ] 基于既有Tiny发布工具建立本轮发布器，复用代码而不复制无关流程。校验质量收据及上传允许集合；禁止预填revision，上传根模型卡前核对远端前值。
- [ ] 先完成两种候选main/Worker×CPU/GPU生命周期，预取消/恢复/重复释放/缓存清理；仅将通过的候选上传双Hub并完整GET回读。
- [ ] 生成新清单并分发元数据；对稳定候选逐一完成双源×两后端×两执行模式的真实下载/校验/推理，确认无静默回退。FP32复用原权重。
- [ ] 更新Demo精度选择、版本路径和实际稳定数量；仅达到两项均稳定时使用40项。保持14规格及默认值。
- [ ] 运行相关单测、文档/示例/发布契约、类型检查、lint、构建、标准检查和Demo桌面/390px验证，审查后提交。

### Task 3: 正式部署与门户选型

**文件：** SDK发布验收记录；门户 `src/content/models/pp-detection.yaml`、比较生成器/测试、生成数据/文档、路线规划及本轮验收报告。

**接口：** 门户消费已合并SDK固定提交与本轮评测批次，保留原38行历史数值；Tiny新精度与本批次FP32比较，不能混用历史FP32耗时作为同批次对照。

- [ ] SDK独立审查、PR、最新HEAD CI通过后合并并核验Pages；正式HTTPS Demo验证双源两后端及精度/导出身份。
- [ ] 门户单独分支登记新增稳定变体，固定SDK提交、模型清单和评测来源；Tiny三精度数据明确批次，不改写其他历史数据。
- [ ] 门户相关测试、生成器检查、build、浏览器筛选/390px和四项目入口通过后PR、CI、合并、部署并正式复核。
- [ ] 同步主仓，普通删除本轮已合并本地/远程分支；保留指定旧分支、未跟踪报告与缓存；报告实际结果。

## 初始验证

2026-09-16：复用干净独立工作树，SDK基线206项测试通过，前置标准检查已保存门户 `.tmp/tiny-precision-standard-before.json`。用户已经授权本阶段执行及达标发布，不重复请求确认。
