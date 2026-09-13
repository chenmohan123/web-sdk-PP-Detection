# PP-Detection 2D 模型兼容矩阵（2026-09-13）

## 结论

PP-Detection 不承诺兼容 PaddleDetection 模型库中的全部模型。当前 SDK 的稳定范围仍是 PicoDet-L-320 1.0.2 与 PP-YOLOE+ S 640 0.1.1 的六个精度变体。它们是本次矩阵的稳定基线，用于比较后续候选，不需要重复移植。

下一轮首选候选是 **PP-YOLOE-SOD**，备选是轻量 **RTMDet** 变体。两者都只是 `candidate`，尚未证明可以在浏览器运行，也没有进入 manifest 或 Demo。PP-YOLOE-SOD 与 0.4.0 的小目标切片增强属于两条不同路线：前者是新模型，后者是现有模型的推理策略实验。

## 判定方式

候选必须先完成固定上游 revision、输入输出签名、许可证、可复现 ONNX 转换和 Python ONNX Runtime 参考输出，再进入浏览器验证。浏览器阶段至少检查 WASM/main，随后按能力检查 WebGPU、Worker、取消、释放和真实输出对齐。所有结论需要记录设备、浏览器、ORT、后端、执行模式和日期。

`candidate` 只表示值得做转换评估；`blocked` 表示不能在当前信息下安全推进；`deferred` 表示属于其他 SDK 或 Workflow；`selected` 只允许在矩阵筛选通过后使用。状态不等同于 stable。

## 当前排序

| 优先级 | 候选                  | 状态      | 选择理由                                   | 主要风险                                 |
| -----: | --------------------- | --------- | ------------------------------------------ | ---------------------------------------- |
|      1 | PP-YOLOE-SOD          | candidate | 与当前轴对齐框契约接近，直接对应小目标场景 | 输入尺寸、输出 NMS、体积和误检收益待验证 |
|      2 | RTMDet tiny           | candidate | 轻量实时检测候选，可作为移动端替代         | 动态检测头和导出算子需要确认             |
|      3 | 其他 PP-YOLOE 规模    | candidate | 可复用已有系列经验                         | 不能假设不同规模共享输出和移动端成本     |
|      4 | PP-YOLO、FCOS、SSD    | candidate | 覆盖原规划的通用 2D 范围                   | 导出图、后处理和维护价值待确认           |
|      — | YOLOv3/5/6/7/8、YOLOX | blocked   | 截图中的系列不是一个统一模型契约           | 必须拆成具体架构、权重和许可证后再评估   |

完整字段、排除项和证据要求见 [candidates.json](candidates.json)。

## 边界

- 旋转框检测、实例分割、关键点检测、多目标跟踪和 3D 检测不加入本 SDK 的 2D manifest；它们需要各自的结果契约和生命周期。
- PP-Human、PP-Vehicle、PP-Sports 先作为 Portal Workflow 候选，不复制其他 SDK 的推理代码到 PP-Detection。
- 模型权重继续通过 ModelScope/Hugging Face 的固定来源按需下载，npm 不内置 ONNX 文件。
- 当前两个稳定模型、ModelScope 默认来源、现有公共 API 和小目标增强默认关闭状态在评估阶段不变。

## 下一步

进入任务 2：固定 PP-YOLOE-SOD 的上游 revision 和许可，执行可复现 Paddle2ONNX 转换，使用固定图片集生成 Python ONNX Runtime 参考输出。转换或输出契约任一项无法确认时，记录 `blocked`，转评 RTMDet tiny；不通过评估门槛时不修改 runtime。
