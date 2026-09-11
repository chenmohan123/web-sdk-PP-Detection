# PP-YOLOE 实验模型分发与 Demo 选择设计

用户已确认继续下一阶段：固定版本模型分发、Demo 模型选择、移动端实机验证。此次属于单 SDK 与其 Demo，不涉及门户运行时、npm 发布、GitHub 合并或 Pages 部署。

## 已验证的输入

使用上一阶段候选 `.tmp/phase2/ppyoloe-plus-s-candidate.onnx`，31,954,220 字节，SHA256 为 `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c`。评测证据位于 `reports/evaluation/2026-09-11-ppyoloe/`，仅代表 64 张 COCO 子集和已有桌面环境。不得修改历史证据或重新解释成全量 COCO 成绩。

## 模型分发

新模型身份为 `ppyoloe-plus-s-640`，分发版本为 `0.1.0-labs.1`。使用已授权的现有模型仓库下 `ppyoloe-plus-s-640/0.1.0-labs.1/` 独立目录；模型卡包含 Apache-2.0 来源、固定上游 revision、转换修复、Pillow 与 OpenCV 预处理差异、评测范围和移动验证限制。先完成上传清单与模型卡，再上传；不覆盖稳定 PicoDet 文件。上传后读取真实提交 revision，固定模型 URL 并下载回验 bytes 与 SHA256。没有身份凭据的来源记录为未分发，不编造 revision。

本地消费入口为 `models/ppyoloe-plus-s-640/manifest.json`，沿用 DetectionManifest，不扩展标准字段。`status: labs`，仅声明实际分发且验证成功的来源。历史 candidate manifest 保留原样。公开 manifest 使用两次提交：先模型得到 revision，再提交引用该 revision 的清单；消费者不依赖 main/master 浮动分支。

## Demo 行为

PicoDet 为默认，新增“PP-YOLOE+ S 640（实验）”模型选项，清楚展示实验状态、下载体积和验证范围。模型与来源是两个独立选择；来源选项从所选模型清单决定，显式来源失败不自动换源。使用随 Demo 构建的固定清单，避免远端浮动 manifest 改变行为。

选择 PP-YOLOE 时显式传入 `allowExperimental: true`；其他模型不得被意外开启实验许可。模型切换应取消当前请求、停止媒体、等待正在运行的任务退出、释放 detector、清空旧结果与加载信息，按模型 id/version 更新缓存身份。迟到的旧请求不得污染新状态。保留图片、视频、摄像头、类别筛选、缓存清理、实际后端与耗时展示。沿用现有 UI tokens 和布局；中文默认，保留语言切换。

## 验证与交付

验证默认模型、候选选择与推理、取消和快速切换、缓存隔离、显式来源错误；运行 Demo 测试、类型检查、构建和 SDK 治理检查。用真实桌面浏览器验证实际模型；390px 视口只证明布局适配。

移动实机需记录设备、OS、浏览器、时间、模型版本与校验值、实际后端、冷/热耗时、成功或失败。设备未提供时交付验证入口与操作清单，将实机状态明确标为待验证。未经实机验证，候选仍为 labs。
