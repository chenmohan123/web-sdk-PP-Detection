# PP-YOLOE 候选与目标检测评测实施计划

> 执行方式：使用 superpowers:subagent-driven-development 按任务实现、验证和审查；步骤以复选框跟踪。用户已确认本轮方向，无需重复确认常规实现选择。

**目标：** 交付 COCO 目标检测评测基线和 PP-YOLOE+ S 的真实候选验证结果。

**架构：** Python 工具负责官方 COCOeval 和检测集合匹配，模型工具负责上游固定来源、导出与参考结果，浏览器通过现有 SDK 读取候选。只有验证完成且来源可复现的能力进入候选接入，不改变现有稳定模型。

**技术栈：** Python 3.11、NumPy、ONNX/ORT、pycocotools、TypeScript、ONNX Runtime Web、Playwright。

**设计：** `docs/superpowers/specs/2026-09-11-ppyoloe-evaluation-design.md`。

## 全局约束

- 所有新增文档、注释、错误说明和提交使用中文；公开指南按仓库规则提供对应入口。
- 仅操作 PP-Detection 功能分支；公共模型与数据只读下载。远程发布不在本轮范围。
- 不修改历史模型报告以伪装本轮结果，不提交 COCO 图片或大型权重；临时产物存 `.tmp/phase2/`。
- 质量评测绑定模型和数据哈希，不用源代码字符串匹配代替行为测试。
- 上游固定提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，候选 PP-YOLOE+ S 640 FP32。

## 任务 1：可复用的质量与一致性评测

**文件：** 新增 `tools/model-pipeline/evaluation/__init__.py`、`coco.py`、`matching.py`、`cli.py`、`requirements.txt`；测试 `tools/model-pipeline/tests/test_detection_evaluation.py`。

**接口：**

```python
evaluate_coco(annotations: dict, predictions: list[dict], image_ids: list[int]) -> dict
compare_detections(reference: list[dict], candidate: list[dict], *, iou_threshold: float = 0.5, score_threshold: float = 0.5) -> dict
```

COCO 预测采用原始 `image_id/category_id`、像素 `bbox=[x,y,w,h]`、`score`；匹配函数每个项目采用 `category_id/bbox/score`。`evaluate_coco` 返回 `metrics`（AP/AP50/AP75/APSmall/APMedium/APLarge/AR1/AR10/AR100）、`imageIds`、`imageCount`、`groundTruthCount`、`predictionCount` 和 `evaluator`；没有定义的指标用 null。CLI 子命令 `coco --annotations --predictions --image-ids --output`，image-ids 是 JSON 数组文件；错误非零退出。

- [x] 先写行为测试：完美预测 AP=1，空预测 AP=0，非连续类别 1/3 正确映射，未知类别和未选图片报错；逆序相同框全部匹配，重复框只匹配一次，空集合正确处理，NaN/无效框拒绝。
- [x] 运行 `python -m pytest tools/model-pipeline/tests/test_detection_evaluation.py -q`，记录缺少实现的失败。
- [x] 使用 pycocotools.COCOeval 实现真实质量评测；匹配采用同类别一对一分配并报告未匹配项，不依赖输入行顺序。CLI 保存 UTF-8 JSON，固定依赖版本。
- [x] 运行上述测试以及 CLI 的完美/空结果用例，保存命令和结果。
- [x] 完成任务审查并记录改动；本地提交由主执行者统一处理。

## 任务 2：COCO 子集和 PP-YOLOE 来源与转换

**文件：** `tools/model-pipeline/ppyoloe/` 的来源/导出/候选清单工具及对应 Python 测试；`tools/model-pipeline/evaluation/prepare_subset.py`；`reports/evaluation/2026-09-11-ppyoloe/` 的轻量锁文件和来源记录。

**接口：** 生成标准 COCO annotations 子集、图片 ID 数组、含 SHA-256 的数据清单，以及候选 ONNX 与完整 runtime manifest。所有模型和图片本体在 `.tmp/phase2/`。

- [x] 从官方固定提交核对 PP-YOLOE+ S 的配置、部署产物和转换方式，记录下载 URL、字节、摘要与环境。
- [x] 固定 COCO val2017 子集，覆盖人物、车辆、动物、小/密集目标，保留标注和许可；选择发生在推理前，不按结果挑图。
- [x] 为来源校验、数据 ID/类别映射和转换输入约束写失败测试；实现能直接重跑的工具。
- [x] 运行官方参考/Python ONNX Runtime，生成两模型 COCO 预测，调用任务 1 的评测入口；记录子集结果而非完整 COCO 成绩。
- [x] 若转换遇到障碍，查明错误阶段并实现最小修复；无法修复时保存可复现失败和候选保持阻塞的原因。

## 任务 3：SDK/浏览器验证与交付

**文件：** 视实际输入契约修改 `packages/sdk/src/` 及对应行为测试；候选接入放在 `examples/` 或现有 Demo 的清单入口；`reports/evaluation/2026-09-11-ppyoloe/README.md` 和浏览器报告。

- [x] 从两模型真实导出结果检查现有 `detect()` 的张量与坐标契约。若需改 SDK，先用真实签名构建回归测试并验证失败，再实现。
- [x] 使用本地已安装 Playwright/Chromium，对固定模型和图片运行严格 WASM、可用物理 WebGPU；记录 Session、首帧、热运行和实际后端。
- [x] 比较 Python 与浏览器输出的同类 IoU 匹配和 COCO 子集质量，确认差异来源。
- [x] 写中文交付报告、公开指南与证据索引，标明候选/稳定状态及设备范围。
- [x] 运行修改后标准检查、相关 Python 测试、SDK 测试/类型/构建、文档/格式以及受影响的浏览器冒烟，完成独立审查。

## 最终证据

见 reports/evaluation/2026-09-11-ppyoloe/verification.md。旧模型测试全集的依赖缺失和格式检查的历史缓存权限限制均已记录；本轮目标测试与真实模型验证已完成。
