# PP-Detection 2D 模型兼容矩阵（2026-09-13）

## 结论

PP-Detection 不承诺兼容 PaddleDetection 模型库中的全部模型。当前稳定范围仍是 PicoDet-L-320 1.0.2 与 PP-YOLOE+ S 640 0.1.1 的六个精度变体；这些模型用于后续比较，不需要重复移植。

本轮对 PP-YOLOE+ SOD L 640 COCO 完成了固定来源下载、官方 Paddle 导出、Paddle2ONNX opset 11 转换、定向 NMS 轴修正、Python 64 图参考核验，以及桌面 Chromium 的 WASM/WebGPU 8 图 smoke。Paddle 与 ONNX 在 64 张图片的 531 个阈值以上检测框全部匹配，最大框坐标差约 0.00018 像素。随后完成了 WASM/main、WASM/Worker、WebGPU/main、WebGPU/Worker 的真实模型生命周期核验；四种组合均通过识别、取消、取消后复用、释放、重复释放和显式来源失败路径，四种组合的 49 个阈值以上框均与 Python 参考匹配。Worker 调度已修复为串行执行，并增加了在途释放与排队请求回归测试。该候选仍标记为 `selected`，不进入稳定 manifest：模型约 345.6 MB，移动端和正式分发审查尚未完成。

RTMDet 的 `blocked` 仅限本次固定版本源码树没有找到 PaddleDetection 入口，不能扩展为所有版本或所有项目均不兼容。

## 判定方式

候选必须固定上游 commit、输入输出签名、许可证和权重摘要，完成可复现转换与 Python ONNX Runtime 参考输出，再进入浏览器验证。浏览器结论记录 WASM/WebGPU、主线程/Worker、设备、浏览器、ORT、后端和日期。`candidate` 表示值得继续评估；`blocked` 必须有版本限定的入口缺失或实测失败证据；`selected` 只表示通过转换和参考核验、允许进入下一轮验证，不等于 stable。

## 当前排序

| 优先级 | 候选                     | 状态      | 依据                                        | 主要风险                             |
| -----: | ------------------------ | --------- | ------------------------------------------- | ------------------------------------ |
|      1 | PP-YOLOE+ SOD L 640 COCO | selected  | 已有完整转换和参考核验，输出接近现有框契约  | 345.6 MB；移动端和 Worker 成本待验证 |
|      2 | RTMDet tiny              | blocked   | 固定的 PaddleDetection 版本树扫描未找到入口 | 需找到明确上游配置、权重和导出链     |
|      3 | PP-YOLOE 其他规模        | candidate | 可复用现有系列经验                          | 每个规模仍需独立转换和移动端评估     |
|      4 | PP-YOLO、FCOS、SSD       | candidate | 保留原规划的通用轴对齐 2D 范围              | 导出图、后处理和维护价值待确认       |
|      — | YOLOv3/5/6/7/8、YOLOX    | blocked   | 系列名不能代替单模型契约                    | 必须拆成具体架构、权重和许可证       |

完整字段、排除项和证据索引见 [candidates.json](candidates.json)、[evidence-index.json](evidence-index.json)。

## 边界

- 旋转框、实例分割、关键点、跟踪和 3D 检测需要各自任务 SDK；本矩阵不把它们写入 2D manifest。
- PP-Human、PP-Vehicle、PP-Sports 属于 Portal Workflow 候选。
- 模型权重通过 ModelScope/Hugging Face 的固定来源按需下载，npm 不内置 ONNX。
- 当前稳定模型、ModelScope 默认来源、公共 API 和小目标增强默认关闭状态不变。

## 下一步

1. 在可用移动设备上记录同一候选的真实浏览器结果；当前记录见 [ppyoloe-sod-lifecycle.json](ppyoloe-sod-lifecycle.json) 和压缩原始证据 [sod-lifecycle.json.gz](evidence/sod-lifecycle.json.gz)。
2. 在可用移动设备上记录同一候选的真实浏览器结果；当前小米 15 的历史结论不能外推到该 345.6 MB 新模型。
3. 评估 ModelScope/Hugging Face 分发条件及模型卡许可后，再决定是否建立独立实现计划。
4. 只有新模型通过上述门槛并完成发布，才更新稳定 manifest 和门户登记。
