# PicoDet 全系列 FP16 与 W8A32 实施计划

> 执行要求：使用 superpowers:subagent-driven-development 按任务实现与审查，使用复选框记录进度。

**目标：** 为 XS/S/M 的 320、416 和 L 的 416、640 八个规格生成 FP16、W8A32 候选，完成桌面对比并发布达标变体。

**架构：** 复用已发布 FP32、通用 float16_models.py、weight_only.py 和 Detection 公共接口。模型按独立版本追加到 ModelScope/Hugging Face，SDK 与门户消费清单；不复制推理实现。

**技术栈：** Python ONNX/ORT、TypeScript、ORT Web 1.27.0、Playwright、现有 COCO 子集评测。

**依据：** 门户 docs/superpowers/specs/2026-08-27-paddle-detection-web-sdk-design.md、standards/v1；用户本次确认的全系列精度和对比范围。

## 全局约束

- 使用中文文档、提交与说明；用户已确认通过门槛后发布。
- 仅八个规格、16 个新增候选；已有 L-320 三精度与 PP-YOLOE S/M/L/X 不重写。
- 默认 PicoDet L-320、FP32、ModelScope 保持；Hugging Face 为可选，显式选择失败不换源或精度。
- 固定已有 64 图 COCO 子集及标注摘要。每个候选仅对比同规格、同后端、同轮 FP32：AP 下降不超过 0.5 个百分点，score >= 0.5、同类 IoU >= 0.5 一对一检测保留率至少 95%；IoU >= 0.99 仅诊断。
- 三轮串行运行 WASM/WebGPU，记录加载、首图、热推理、端到端和体积；体积减少独立计为优势，不要求推理加速，不由大小推导内存。
- 不通过者保留 labs 原始证据，不降低门槛；每个发布变体需 main/Worker 生命周期和双源下载校验。桌面优先，手机不作为前置门槛。
- 所有证据绑定模型、清单、SDK、图集和环境；未测试能力不声明。W8A32 激活与卷积为 FP32。
- 不上传 ONNX 到 npm/git；不输出凭据，不改变宿主 gh 登录。保留其他分支和报告。

## Task 1: 候选转换与输入身份

文件：新增 reports/evaluation/2026-09-15-picodet-series-precision/prepare.py、protocol.json、jobs.json、各候选清单与 conversion.json；复用 tools/model-pipeline/float16_models.py、weight_only.py。

输入：reports/evaluation/2026-09-14-picodet-series/jobs.json 与对应稳定清单，.tmp/picodet-series 下已发布 FP32。
输出：jobs 每项 key、precision（fp32/fp16/w8a32）、model、manifest、bytes、sha256、inputSize；共24项。ONNX 在 .tmp/picodet-series-precision，清单 status=labs。

- [x] 检查源权重 bytes/SHA、输入尺寸、输出 dtype、有限值与固定来源。
- [x] 复用通用转换器，固定 FP16 敏感算子边界与 W8A32 排除规则，先 XS/S 后 M/L；必要调整记录原因与失败图，禁止覆盖已有已评测产物。
- [x] ONNX full check 与真实 Python ORT 加载/推理；检查候选文件变小、形状与 dtype 未破坏。共享工具确需改动时先添加失败用例再实现。
- [x] 生成不可混用的清单与转换报告；验证断点恢复检查源/输出摘要和转换配置。

## Task 2: 三轮质量与耗时

文件：同目录 browser.mjs、summarize.py、test_quality.py、test_publish.py、summary.json、artifact-index.json、evidence/、README.md。
输入：Task 1 jobs；输出：八规格×三精度×两后端×三轮，共144组完整运行和每个候选的发布判断。

- [x] 复用 runEvaluation，绑定固定图集、模型、清单、SDK，禁止复用身份不同或不完整结果。
- [x] 串行运行，每轮每后端使用对应 FP32 比较；保存失败和物理 GPU 身份。
- [x] 使用现有 evaluate_coco 与 compare_detections 复算 AP 和匹配，归档 gzip 和原始字节摘要。
- [x] 证据校验覆盖缺失组合、重复轮次、摘要损坏、错误模型/后端/协议与不完整64图；不依赖 assert 在 Python -O 下的行为。
- [x] 输出逐规格三精度对比，区分体积与推理收益，注明固定子集和日期环境。

## Task 3: 达标变体分发与 Demo

文件：models/pp-detection/picodet-*/1.0.1/，apps/demo/src/model-sources.ts，scripts/stage-pages-models.mjs，sdk-manifest.yaml，相关测试及双语模型文档。
输入：Task 2 每个变体三轮质量与身份通过；输出：仅达标的新版本清单及可用精度选项。

- [x] 增量发布权重到双 Hub，完整回读 bytes/SHA，保留许可和固定 revision；FP32 复用既有权重地址。
- [x] 发布不可变元数据，追加版本清单，更新模型选项和发布暂存，默认值不改。
- [x] 桌面 main/Worker 两后端加载、推理、预取消、恢复、释放与双源浏览器下载；失败者不稳定发布。
- [x] 运行 SDK 标准检查、相关测试、类型检查、构建、Demo 桌面/390px 浏览器检查；更新对比和限制。

## Task 4: 合并发布与门户同步

- [ ] 审查差异、提交并创建 PR，CI 通过后按保护合并，核实正式 HTTPS Demo 的候选身份和可选精度。
- [ ] 门户单独分支同步达标资产与摘要，相关测试/构建/浏览器验证通过后 PR、合并、Pages 核验。
- [ ] 若运行时/API 不变，SDK/npm 保持0.4.0，模型版本独立发布；仅清理本轮已合并分支。

## 当前记录

- 2026-09-15：复用干净独立工作树 .worktrees/detection-picodet-series-fp32，基线3344ffc，分支codex/picodet-series-precision；SDK基线206/206通过。
- 旧picodet/convert_fp16.py限定320，但实际三精度发布使用通用float16_models.py；本次优先复用通用转换器。

- 2026-09-15：三轮144组与288份归档离线复算完成，16候选中14通过；XS-320/416 W8A32保留率94.38%/94.12%，保留labs。候选56组生命周期通过，双Hub权重上传和60个文件完整回读通过。复算收据及发布身份门禁已补齐，详细转换记录16份已归档。

- 2026-09-15 本地发布验收完成：SDK verify（206测试及构建）通过；Demo类型检查、构建及85测试通过；标准required失败0。稳定权重双源60文件和元数据双源50文件回读、28组双源浏览器、候选与最终各56组生命周期全部通过。准备PR与正式Pages验证。
