# PP-YOLO Tiny 320 FP32 发布实施计划

> 执行方式：使用 superpowers:subagent-driven-development 按任务实施，主代理统一进行外部分发、集成验证及合并。

**目标：** 将通过可行性评估的Tiny FP32作为第14个规格、第38个稳定变体发布至双Hub、独立Demo和门户。

**架构：** 通过现有manifest声明Tiny预处理和NMS输出，复用Detection SDK 0.4.0。先核验既有质量证据与产物，再分发权重、生成固定revision清单，验证后登记Demo和门户。

**技术栈：** Python/ONNX、ModelScope与Hugging Face SDK、TypeScript/React/Vite、Playwright、Astro门户。

**设计依据：** 门户 `docs/superpowers/plans/2026-09-13-pp-detection-multi-model-roadmap.md` 的“Tiny 320 FP32独立发布准备”；SDK `reports/evaluation/2026-09-15-2d-candidates/README.md`，固定提交 `652d00fcaf5854207792ef2b149aa1f5a9bd7d33`。用户已批准本阶段及后续PR、合并、分支清理。

## 全局约束

- SDK/npm保持0.4.0；默认PicoDet-L-320、FP32、ModelScope。Demo来源仅ModelScope和Hugging Face。
- 模型ID为 `ppyolo-tiny-320`，首个稳定版本 `0.1.0`，变体ID `fp32`。
- 模型路径 `models/ppyolo-tiny-320/0.1.0/manifest.json`；Hub路径 `ppyolo-tiny-320/0.1.0/ppyolo-tiny-320-fp32.onnx`。
- 最终ONNX固定4,511,117字节、SHA-256 `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653`，opset14、float32 NCHW `1×3×320×320`，COCO80类。
- 保持可行性批次的预处理、输出、模型字节和SDK bundle；任一变化须重新评测，不能沿用不对应的质量证据。
- 不修改runtime；桌面优先，当前证据不声明移动端或WebNN支持。Tiny仅提供FP32。
- 不覆盖已发布文件；新目录采用固定revision，两Hub文件完整回读。根模型卡更新先核对前值，防止覆盖其他工作。
- 文档、回复、提交和新增注释使用中文；公开双语文档保持信息一致。
- 保留用户文件、旧分支和实验缓存。上传凭据复用宿主状态，不写入代码、报告、命令参数或日志。

## 任务1：固定发布资产与验证工具

**文件：** 新建 `reports/distribution/2026-09-15-ppyolo-tiny/{publish.py,test_publish.py,browser.mjs,README.md}`；生成同目录协议、验收收据和上传/回读记录；生成 `models/ppyolo-tiny-320/0.1.0/{README.md,LICENSE,manifest.json,conversion.json}`。

**接口：** `publish.py`提供 `prepare`、`weights`、`verify-weights`、`manifests`、`metadata`、`verify-metadata`、`validate` 命令。暂存目录 `.tmp/tiny-release/publication/`；模型来自 `.tmp/candidate-2d-20260915/ppyolo-tiny-320-fp32.onnx`。`browser.mjs`读取最终manifest，输出 `browser.json`。

- [ ] 为发布边界添加有意义的失败测试：错误模型摘要、缺少质量轮次/证据、额外暂存文件、重复来源或错误回读身份、复用上传状态时文件变化，均须拒绝。
- [ ] `prepare`运行旧报告只读复算，固定来源、评估器、输入/输出/预处理和产物摘要，计算并明确参数统计口径，生成模型卡、许可和转换归因。阶段清单只在固定双源revision可用后生成。
- [ ] `weights`仅上传新版本目录权重、模型卡和许可，保存每源真实revision及允许文件集合；断点复用先验证状态一致。`verify-weights`完整下载并核对每个字节摘要。
- [ ] `manifests`复用候选输入/输出/预处理，补齐stable、默认来源、variant字段及双源不可变URL；保留量化none、参数统计口径和日期/设备边界。`metadata`分发最终清单、转换记录、模型卡及根目录索引，上传前核验根卡前值。
- [ ] 浏览器验证双源×CPU/GPU×main/Worker共8组：真实下载与SHA校验、固定样例检测、显式来源/后端/精度、预取消、恢复、释放、重复释放和缓存命中/清理；同组合结果比对，拒绝回退与软件GPU。采集真实SDK/模型/清单摘要和环境，不把进行中取消竞态列为已覆盖。
- [ ] 运行 `python -m pytest reports/distribution/2026-09-15-ppyolo-tiny/test_publish.py -p no:cacheprovider`、来源及产物摘要核验，审查后由主代理执行上传和真实浏览器命令，保存原始结果。

## 任务2：Demo与SDK文档接入

**文件：** 修改 `apps/demo/src/model-sources.ts`、`apps/demo/tests/model-selection.spec.ts`、`scripts/stage-pages-models.mjs`及其相关测试、`scripts/check-doc-parity.test.mjs`、`README.md`、`README.en.md`、`packages/sdk/README.md`、`docs/zh-CN/models.md`、`docs/en/models.md`、`models/README.md`、`sdk-manifest.yaml`、`CHANGELOG.md`。

**接口：** 消费任务1最终manifest；新增 `DemoModelKey = ... | "ppyolo-tiny-320"`，在现有模型选项后添加Tiny，label为 `PP-YOLO Tiny 320`，manifestPath为固定版本路径。

- [ ] 调整既有选项列表预期，并加入从已有模型FP16切换Tiny后重置FP32/ModelScope、仅FP32可用、清单与展示身份一致的行为验证。
- [ ] 按上述接口接入Tiny稳定选项与Pages清单复制，默认模型不变。来源只提供双Hub，禁止自动跨来源换源。
- [ ] 同步14规格/38变体、模型说明、4.51MB与质量/速度取舍及实验报告链接；保留历史批次记录，新增变更日志，不改npm版本。
- [ ] 运行Demo相关测试、SDK全量检查、构建、Pages暂存核验和后置标准检查。提交前按发布与Demo模板逐项记录结果。

## 任务3：发布Demo并同步门户选型

**文件：** SDK发布报告及验收清单；门户 `src/content/models/pp-detection.yaml`、`tools/detection-comparison/build.mjs`、对应测试、生成的选型数据/文档、路线规划和正式验证记录。

**接口：** 门户只消费已合并SDK固定提交的manifest和Tiny可行性报告，不读取工作树未发布内容；Tiny作为独立评测批次加入，其他37项维持原始批次证据。

- [ ] SDK独立审查通过后创建PR，等待最新HEAD全部适用CI通过，合并并核对Pages部署提交。正式HTTPS运行Tiny两来源×两后端4组检测，确认默认模型、来源与旧选项可用。
- [ ] 门户登记第38项资产，固定SDK合并提交；扩展比较生成器读取Tiny的6份真实轮次，校验模型/SDK/图集身份，AP和耗时采用本批次结果。不得将PicoDet对照差值当成Tiny相对自身FP32的精度损失。
- [ ] 选型页增加PP-YOLO系列筛选，保持现有37行数据、四项目目录和390px布局；测试38项、4批次及Tiny筛选，并运行门户单测、构建和浏览器验证。
- [ ] 同步路线规划为已发布，经过门户PR/CI/合并/Pages和正式HTTPS复核后完成；只清理本轮已合并分支。

## 验收

只有双源回读、8组合生命周期、Demo真实检测、标准检查、相关测试与CI、正式部署全部完成，才报告Tiny稳定上线。报告记录实际失败及修复，不以功能探测或mock替代真实模型验证。
