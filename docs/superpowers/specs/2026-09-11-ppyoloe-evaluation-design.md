# PP-Detection 第二模型与评测基线设计

- 日期：2026-09-11
- 状态：用户已确认推进「目标检测评测基线 + PP-YOLOE 候选验证」；具体结论以本轮实测为准。
- 分层：单 SDK；基线提交 `ccc115f`，SDK 版本 0.2.0。
- 依据：门户 `standards/v1/README.md`、SDK/性能/Demo 契约、2026-08-27 原始设计及 2026-08-31 FP32 发布范围调整。

## 目标与边界

建立可以重复使用的目标检测质量评测入口，使用真实带标注图片比较现有 PicoDet 与 PP-YOLOE 候选。首个候选为官方 PP-YOLOE+ S、640×640、FP32；上游 PaddleDetection 固定为 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`。

本轮完成候选的来源核验、转换、Python ORT 与浏览器 WASM/WebGPU 验证。只有真实结果支持时才接入模型选项；未通过的阶段必须记录错误、可复现命令和后续修复方向。FP16、INT8 和小目标专用模型不纳入本轮交付。

保持 `detect()` 结果和 SDK 生命周期；模型的预处理、输出张量、坐标语义与标签由清单确定。若候选需要辅助输入，优先在转换产物中明确固定其语义，不能在 SDK 按文件名猜测。模型权重不加入 npm，也不在本轮上传模型或发布 npm/Pages。

## 评测数据与指标

使用 COCO val2017 的带标注子集，固定选择规则、图片 ID、原始类别 ID、文件 SHA-256、图片许可与公开来源。所有模型使用同一份子集；子集结果明确标为局部观测，不能写成完整 COCO mAP。图片与完整标注下载在 `.tmp/phase2/`，提交轻量清单和结果；保留官方注释的来源与许可，不把图片统一改标为 SDK 许可。

质量指标交给官方 pycocotools COCOeval（bbox），输出 AP@[.50:.95]、AP50、AP75、AP small/medium/large、AR，以及评测图片和目标数量。完整保留 crowd/ignore 语义、原始非连续 COCO category_id 和最大检测数。没有标注的预测图片、重复图片 ID、未知类别、非有限分数/坐标和无效框必须报错，不能生成看似有效的分数。

转换/浏览器一致性单独使用同类别的一对一 IoU 匹配。报告匹配数、未匹配参考/候选数量、分数偏差和框偏差；行顺序变化不能单独造成失败，重复预测不能重复匹配同一个参考框。空结果需区分两侧均为空与只有一侧为空。此比较不能替代对真实标注的 COCOeval。

## 候选与性能

锁定官方模型配置和权重来源，下载后记录实际字节和 SHA-256；记录导出依赖、命令、ONNX opset、输入输出和参数量。保持 FP32 基线与已发布 PicoDet 的哈希一致。

PP-YOLOE+ S 预处理从固定上游 `ppyoloe_plus_reader.yml` 的 TestReader 提取：stretch 到 640×640、RGB/CHW、除以 255、mean=[0,0,0]、std=[1,1,1]、OpenCV INTER_CUBIC（interp=2）。它与旧 PP-YOLOE reader 的 ImageNet mean/std 不同。参考推理与浏览器输入应使用一致的变换；现有 SDK 的 Pillow bicubic 与 OpenCV INTER_CUBIC 也不能直接当作相同算法，任何差异独立说明。

浏览器验证调用本 SDK 的真实公开入口，明确 requested/actual backend，禁用静默回退；先单图验证，再运行共用图片子集。性能分开记录 Session 创建、首帧和复用会话后的重复运行，并保留浏览器/OS/CPU/GPU/ORT/日期；不将 Python CPU 耗时和浏览器 GPU 耗时写成同环境对比。

## 完成条件

1. 评测工具有覆盖错误映射、空检测、重复框和顺序变化的行为测试；COCO 指标由官方实现生成。
2. 有真实 COCO 子集、PicoDet 结果与可复现评测命令。
3. PP-YOLOE 每阶段均有实际通过证据或精确阻塞记录；不能使用版面模型的历史 FP16 报告补证。
4. 若候选通过运行与质量检查，提供本地 SDK 接入及验证；未获得公开分发 revision 时保持候选状态。
5. 修改前后标准检查、相关 Python/SDK 测试、构建、受影响的浏览器冒烟通过。报告保留证据范围和未验证项。

## 历史证据

保留历史报告原文，在新证据索引中明确其模型归属。`tools/model-pipeline/reports/1.0.1/variant-validation.json` 内的 800×800、mask/reading-order FP16 记录不属于当前 PicoDet；本轮不使用它作为候选验证依据。

## 接入验证后的补充决定

现有 SDK 默认仅运行稳定变体。增加显式 allowExperimental 选项用于本地 labs 候选验证，默认关闭，blocked 永远拒绝，同精度 stable 优先。候选清单仍标为 labs，不能通过改写状态绕过验证门槛。
