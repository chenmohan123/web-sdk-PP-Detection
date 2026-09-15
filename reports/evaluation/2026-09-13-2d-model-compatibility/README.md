# PP-Detection 2D 模型兼容矩阵（2026-09-13）

> 本文是2026-09-13历史批次。当前稳定范围已为13个规格、37个变体；2026-09-15的PP-YOLO Tiny、FCOS、SSD具体候选结论见[后续筛选报告](../2026-09-15-2d-candidates/README.md)，不使用本页旧数量或旧顺序代表当前状态。

## 结论

PP-Detection 不承诺兼容 PaddleDetection 模型库中的全部模型。当前稳定范围仍是 PicoDet-L-320 1.0.2 与 PP-YOLOE+ S 640 0.1.1 的六个精度变体；这些模型用于后续比较，不需要重复移植。

本轮对 PP-YOLOE+ SOD L 640 COCO 完成了固定来源下载、官方 Paddle 导出、Paddle2ONNX opset 11 转换、定向 NMS 轴修正、Python 64 图参考核验，以及桌面 Chromium 的 WASM/WebGPU 8 图 smoke。Paddle 与 ONNX 在 64 张图片的 531 个阈值以上检测框全部匹配，最大框坐标差约 0.00018 像素。随后完成了 WASM/main、WASM/Worker、WebGPU/main、WebGPU/Worker 的真实模型生命周期核验；四种组合均通过识别、取消、取消后复用、释放、重复释放和显式来源失败路径，四种组合的 49 个阈值以上框均与 Python 参考匹配。Worker 调度已修复为串行执行，并增加了在途释放与排队请求回归测试。该候选仍标记为 `selected`，不进入稳定 manifest：模型约 345.6 MB，移动端尚未验证，权重许可适用范围及固定分发镜像尚待补证。

RTMDet 的 `blocked` 仅限本次固定版本源码树没有找到 PaddleDetection 入口，不能扩展为所有版本或所有项目均不兼容。

同日完成 [SOD L 与普通 PP-YOLOE+ L 的公平对照及分发审查](../2026-09-13-sod-comparison/README.md)。64 图桌面 WebGPU 的小目标 AP 为 39.37 对 39.06，仅提升 0.32 个百分点，体积增加 65.24%；中、大目标 AP 略降。本轮暂缓优先稳定接入 SOD，保留 `selected` 的转换兼容结论；分发许可适用范围和固定镜像仍需补证。

## 判定方式

候选必须固定上游 commit、输入输出签名、许可证和权重摘要，完成可复现转换与 Python ONNX Runtime 参考输出，再进入浏览器验证。浏览器结论记录 WASM/WebGPU、主线程/Worker、设备、浏览器、ORT、后端和日期。`candidate` 表示值得继续评估；`blocked` 必须有版本限定的入口缺失或实测失败证据；`selected` 只表示通过转换和参考核验、允许进入下一轮验证，不等于 stable。

## 初始候选排序与当前结果

下表保留首轮评估顺序；SOD 的当前接入决策见上述同规模对照报告，不代表仍优先发布。

| 优先级 | 候选                     | 状态      | 依据                                        | 主要风险                               |
| -----: | ------------------------ | --------- | ------------------------------------------- | -------------------------------------- |
|      1 | PP-YOLOE+ SOD L 640 COCO | selected  | 转换、参考核验和桌面四种执行组合已通过      | 345.6 MB；移动端未验证，正式分发待审查 |
|      2 | RTMDet tiny              | blocked   | 固定的 PaddleDetection 版本树扫描未找到入口 | 需找到明确上游配置、权重和导出链       |
|      3 | PP-YOLOE 其他规模        | candidate | 可复用现有系列经验                          | 每个规模仍需独立转换和桌面兼容验证     |
|      4 | PP-YOLO、FCOS、SSD       | candidate | 保留原规划的通用轴对齐 2D 范围              | 导出图、后处理和维护价值待确认         |
|      — | YOLOv3/5/6/7/8、YOLOX    | blocked   | 系列名不能代替单模型契约                    | 必须拆成具体架构、权重和许可证         |

完整字段、排除项和证据索引见 [candidates.json](candidates.json)、[evidence-index.json](evidence-index.json)。

## 边界

- 旋转框、实例分割、关键点、跟踪和 3D 检测需要各自任务 SDK；本矩阵不把它们写入 2D manifest。
- PP-Human、PP-Vehicle、PP-Sports 属于 Portal Workflow 候选。
- 模型权重通过 ModelScope/Hugging Face 的固定来源按需下载，npm 不内置 ONNX。
- 当前稳定模型、ModelScope 默认来源、公共 API 和小目标增强默认关闭状态不变。

## 下一步

桌面 Chromium 的 WASM/WebGPU、main/Worker 和生命周期核验已完成，见 [ppyoloe-sod-lifecycle.json](ppyoloe-sod-lifecycle.json) 和压缩原始证据 [sod-lifecycle.json.gz](evidence/sod-lifecycle.json.gz)。后续迭代先确保电脑端通过与改动相关的验证，不要求每轮重复手机测试。

1. 普通 L 同规模对照与分发审查已完成；保留 [接入结论和可复现证据](../2026-09-13-sod-comparison/README.md)，本轮不进入 SOD 稳定实现。
2. 下一阶段优先评估普通 PP-YOLOE+ L 的 FP16/W8A32 体积与识别保持程度；SOD 在专项目标集显示更充分收益或体积成本显著降低后再复查。固定 ModelScope/Hugging Face 来源及许可适用范围仍是正式发布前待办。
3. 候选准备发布、涉及移动端专项问题或重大 runtime 变化时，按影响范围安排移动设备人工 smoke；缺少手机证据不阻塞桌面评估与后续开发。当前小米 15 的历史结论不能外推到该 345.6 MB 新模型，未验证时明确记录移动端未知。
4. 只有新模型通过上述门槛并完成发布，才更新稳定 manifest 和门户登记。
