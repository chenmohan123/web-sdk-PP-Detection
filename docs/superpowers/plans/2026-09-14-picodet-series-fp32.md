# PicoDet 常规系列 FP32 补齐实施计划

> 执行要求：使用 superpowers:subagent-driven-development 按任务实施并审查；步骤采用复选框记录。

**目标：** 在现有 Detection SDK 和 Demo 中提供 PicoDet XS/S/M 的 320、416，以及 L 的 320、416、640 九个 FP32 规格。

**架构：** 沿用官方带后处理 ONNX、单 image 输入、stretch/bicubic 预处理和检测矩阵输出。L-320 复用已发布 1.0.2 文件，其余八个建立独立 0.1.0 清单；统一运行时不因模型规格复制实现。

**技术栈：** Python ONNX / ONNX Runtime，TypeScript SDK，React Demo，ORT Web 1.27.0，Playwright。

**设计依据：** 用户在本任务中已确认九规格、ModelScope 默认 / Hugging Face 可选、桌面 CPU / WebGPU 验证后发布；门户标准 standards/v1 的 sdk、demo、performance、docs-release 契约。

## 全局约束

- 所有新增文档、注释、提交和沟通使用中文。
- 仅九个常规规格；S-NPU、FP16/W8A32 新变体和 WebNN 后端不属于本轮。
- 默认仍为 PicoDet L-320 / FP32 / ModelScope；不重写已有发布清单和权重。
- 新清单仅声明 ModelScope 与 Hugging Face，固定 revision、bytes、SHA-256；来源错误不能静默换源。
- 发布门槛：64 图固定 COCO 子集，官方原始 ONNX 与处理后 ONNX 相同输入的 FP32 比较；桌面 WASM / WebGPU 都完成，无非有限输出、错类或严重框偏移；相对同规格参考 AP 下降不超过 0.5 个百分点，score >= 0.5、同类 IoU >= 0.5 一对一匹配保留率至少 95%。
- 浏览器原图使用 SDK bicubic；必须保留预处理差异，不将不同图像解码的误差称为转换错误。输出绑定权重、清单、图片、标注、SDK 字节身份。
- 生命周期覆盖 main / Worker、加载 / 推理 / 释放；手机不作为本轮前置条件。
- 不修改现有 NPU 报告，不清理其他分支，不输出凭据。

## Task 1: 官方图适配与候选文件

文件：`tools/model-pipeline/picodet/sanitize_onnx.py`、`inspect_onnx.py`，对应 `tests/test_picodet_series.py`；新增 `reports/evaluation/2026-09-14-picodet-series/prepare.py`、`sources.lock.json`、`jobs.json`、候选清单。

输入：官方 README 中九个 `picodet_{size}_{resolution}_lcnet_postprocessed.onnx` 地址；已有 L-320 1.0.2 清单。输出：八个新文件及 L-320 引用，统一 jobs 项含 key、model、manifest、bytes、sha256、inputSize、sourceModel。

- [ ] 为显式 416 / 640、非法尺寸和已有默认 320 添加有意义的图契约测试；先运行失败用例。
- [ ] 适配单输入清理和检查函数，增加 keyword 参数 `input_size: int = 320`，未知输入拒绝，禁止将 416 / 640 图误标为 320；保留现有默认行为。
- [ ] 下载官方文件，记录下载 URL、字节、SHA、固定官方配置 revision 与许可来源。实际检查每个模型的图输入、输出、opset 与算子，不预设所有图相同。
- [ ] 创建候选 ONNX 于 `.tmp/picodet-series/`，有需要时只做可证明等价的兼容处理；新建候选清单 status=labs，仅供本地评测，禁止虚构远程来源通过。
- [ ] 同一输入跑官方 / 处理后 Python ORT 对照，记录误差与有效检测；使用真实权重完成测试后提交代码和小型证据，不提交大权重。

## Task 2: 桌面质量与生命周期证据

文件：`reports/evaluation/2026-09-14-picodet-series/browser.mjs`、`evaluate.py`、`summary.json`、`README.md`；复用 `tools/model-pipeline/browser/evaluation-runner.mjs` 与固定 64 图集。

输入：Task 1 jobs；输出：每个规格 WASM / WebGPU 质量、耗时、main / Worker 结果及固定 SHA 索引。

- [ ] 构建当前 SDK，验证 64 张图片与现有 dataset lock 字节一致。
- [ ] 串行执行各规格浏览器 CPU / GPU 推理，保留运行环境和物理 GPU 身份。
- [ ] 以同规格官方参考评估 AP 和一对一检测保留率，保存所有失败，不降低门槛以通过。
- [ ] 验证 main / Worker 加载、运行和释放，失败则定位并修复后重跑受影响组合。
- [ ] 归档压缩输出、摘要与复现入口，独立审查完整性和通过结论。

## Task 3: 双来源与 Demo 接入

文件：`models/picodet-*/0.1.0/{manifest.json,README.md,LICENSE}`、`apps/demo/src/model-sources.ts`、`scripts/stage-pages-models.mjs`、相关 contract 测试及 `sdk-manifest.yaml`。

输入：Task 2 通过的八份 ONNX；输出：稳定双来源清单和九规格 Demo 模型选项。

- [ ] 将验证通过的文件追加上传既有 ModelScope / Hugging Face 模型仓库，保留模型来源与许可；通过宿主既有认证，不改变登录状态。
- [ ] 读取不可变 revision，下载核对 bytes / SHA / CORS，创建最终清单；再按最终清单完成真实下载与推理。
- [ ] 用既有 MODEL_OPTIONS 模式增加八项，顺序 XS/S/M/L 各输入尺寸，再 PP-YOLOE+；默认 L-320 不变。仅 FP32 的模型不得保留无效精度选择。
- [ ] 更新静态模型发布暂存与 SDK 标准模型条目，按数据驱动清单校验九规格覆盖和默认来源。
- [ ] 运行 SDK 测试、类型检查、构建和 Demo 浏览器测试，桌面与 390px 截图检查选项、图片和结果没有溢出或错位。

## Task 4: 发布与收尾

文件：模型清单索引、README、模型 / 兼容 / 转换说明、发布记录及门户模型目录受影响条目。

- [ ] 用模板记录新增八个规格、许可、桌面实测范围、模型版本及 SDK 版本决策；不宣称手机或 NPU 已验证。
- [ ] 执行前后标准检查、相关 tests / build / 浏览器 smoke，独立审查最终差异。
- [ ] 在用户已确认“通过后发布”的范围内创建 PR 并按仓库保护合并，复用宿主 gh 认证；运行自托管 runner 时使用 F:/github-runner。
- [ ] 核实发布流水线、正式 Demo 九个 PicoDet 选项及默认值，记录线上 SHA 与版本。
- [ ] 保留已有 `codex/fix-runtime-performance`，仅处理本轮已合并分支；报告最终结果和未通过项目。

## 当前记录

- 隔离工作区：门户 `.worktrees/detection-picodet-series-fp32`，分支 `codex/picodet-series-fp32`，基线 `19346d200c2993d92e37838ab43aea236ed516a8`。
- 基线 SDK 测试 206/206；标准检查 required 失败 0。
- 决策：复用官方已导出 ONNX，先验证图一致性；遇到不兼容图再针对对应规格处理。
