# PP-YOLOE+ SOD L 640 COCO 分发许可与来源审查（2026-09-13）

## 审查范围

本审查针对固定上游 PaddleDetection 提交 `b25522a0f4bde8c80603f3ba5e3472059972e3b5` 导出的 PP-YOLOE+ SOD L 640 COCO ONNX（345,644,377 bytes，SHA256 `a8fb0978485d42f78346339490302e4f3116daa2cdc7c192b2e2250b1675cd2e`）。仅做只读核对，没有上传模型、创建仓库或使用任何临时令牌。

## 已核实事实

1. 固定提交的 `LICENSE` 可读取，内容为 Apache License 2.0，SHA256 为 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`。来源、HTTP 状态和摘要见 `distribution-evidence/source-snapshot.json`。
2. 固定提交的 `NOTICE` 路径返回 404；锁定快照也未发现独立 NOTICE 文件。这表示当前快照没有可附带的 NOTICE 文本，不能据此推断没有第三方组件或第三方权利义务。
3. 官方 `configs/smalldet/README.md` 明确列出 COCO 的 PP-YOLOE+_SOD-l 模型、权重下载地址和 COCO 训练/验证设置，并报告 AP、AP50、APSmall 等指标。该文档没有为训练权重给出独立再分发许可证。
4. `sources.lock.json` 记录的原始 Paddle 权重来源为 `https://paddledet.bj.bcebos.com/models/ppyoloe_plus_sod_crn_l_80e_coco.pdparams`，大小 351,463,346 bytes、SHA256 `6982308d871e0d4285dc8577814409b077ef947fef9d59ef6497b86f9f153e87`，并明确 `separateWeightLicenseFound: false`。
5. COCO 官方条款正文已保存于 `distribution-evidence/coco-terms.json`（从网站导航脚本定位正文地址，不以首页 HTML 代替条款）。标注采用 CC BY 4.0，图片权利归原作者。公开模型资产只分发转换后的权重，不打包图片或标注；独立评测报告引用的子集标注按 CC BY 4.0 归因。模型卡不能把 COCO 条款写成模型权重许可。

## 来源平台核对

### ModelScope

只读调用 ModelScope 公共模型列表，以 `ppyoloe` 搜索得到 1 个结果：`AIBS/ppyoloe`。本次读取的默认分支文件列表只有 README、配置和元文件，没有本次 SOD L 640 权重；未枚举其全部 tag。仓库元数据的 license 为空，README 还声明内容主要用于研究/参考。该仓库不是已核实的 PaddleDetection 官方 SOD 分发来源，也不能作为默认来源。此次查询的返回摘要见 `distribution-evidence/modelscope-search.json`，不将单关键词搜索推断为平台上不存在任何其他镜像。

因此 ModelScope 路径可作为**待创建的正式发布目标**：需要由有权发布者创建明确的仓库、上传固定 ONNX、提供 commit/tag 或文件摘要、补齐许可证和模型卡后，才能写入 SDK 来源清单。当前并未上传或发布。

### Hugging Face

只读 API 搜索得到 `ChatchatTech/ppyoloe_crn_l_ustc_0103` 和 `ownlwh/bookbuddy-ppyoloe-r-s-dev` 两个结果。它们均不是已识别的 PaddleDetection 官方 PP-YOLOE-SOD L COCO 仓库，搜索结果不能证明权重许可或来源连续性。完整响应摘要见 `distribution-evidence/huggingface-search.json`。

因此 Hugging Face 也只能作为**待创建的正式发布目标**，需使用不可变 revision、文件 SHA256、模型卡和许可证后再登记。

## 发布判定

**判定：可以进入分发准备阶段；当前不能宣称已正式分发，也不能将任一现有公共仓库写为已验证来源。**

Apache-2.0 足以覆盖固定源码仓库中相应代码的许可条件，但源码许可证本身不是训练权重全部权利的证明。当前证据没有发现“明确禁止再分发”的声明，同时也没有发现权重的独立授权、作者确认或平台仓库许可。因此应把权重许可视为待核实条件，而不是作肯定或否定的法律结论。

## 建议的模型卡最小内容

- 模型名称：PP-Detection PP-YOLOE+ SOD L 640 COCO；任务为 2D 目标检测；输入 `1×3×640×640`、FP32、ONNX opset 11。
- 上游来源：PaddlePaddle/PaddleDetection，固定 commit `b25522a0f4bde8c80603f3ba5e3472059972e3b5`；附 Apache-2.0 LICENSE 链接和本项目转换说明。
- 权重来源：说明原始 `.pdparams` URL、转换工具链、转换后 ONNX SHA256/字节数；发布仓库使用不可变 tag/commit。
- 许可字段分开写：源码 Apache-2.0；权重许可填写已获得的明确授权或“许可待确认，暂不作为公开下载”；不要把源码许可自动延伸为权重许可。
- 数据集与归因：注明 COCO train2017 微调、val2017 评估；官方配置另引用 Objects365 预训练权重，保留这一训练来源；链接 COCO 官方条款，模型资产不打包图片/标注，不暗示 COCO 授予模型权利。
- 性能与限制：保留 AP、APSmall 等官方参考指标及本次 Python/Chromium 桌面复核证据；注明 345.6 MB、移动端尚未复核、模型仅适用于当前输入签名。
- 变更与完整性：列出模型卡版本日期、ONNX 文件 SHA256、来源 revision、转换差异（包括 Squeeze 轴和固定 batch/scale_factor 修正）。本轮已完成 [模型卡草稿](model-card-draft.md)。

## 未解决事项与进入正式发布的门槛

1. 取得并留存权重再分发授权或上游/权利人明确许可；若无法取得，保持私有候选，不开放下载。
2. 在 ModelScope 和 Hugging Face 各创建（或确认）正式仓库，锁定不可变 revision，上传前后独立计算 SHA256，并确认平台仓库许可证字段与模型卡一致。
3. 普通 PP-YOLOE+ L 与 SOD L 的公平对比已完成，见 [对照结论](../README.md)。当前样本收益有限，暂不优先稳定接入 SOD；待新的专项目标集或更低体积成本支撑后再复查。
4. 发布候选进入稳定清单前，再按影响范围安排一次移动设备人工 smoke；移动端验证不是每轮桌面迭代的重复门槛。
5. 正式发布后才更新 SDK manifest 的来源、稳定状态和门户登记，并保留平台页面及 revision 的日期证据。

## 证据索引

- `distribution-evidence/source-snapshot.json`：固定 commit 的 LICENSE、NOTICE、SOD 配置/模型库文档、原始权重锁定信息与 COCO 条款摘要。
- `distribution-evidence/modelscope-search.json`：ModelScope 公共搜索及 `AIBS/ppyoloe` 文件/元数据只读快照。
- `distribution-evidence/huggingface-search.json`：Hugging Face `ppyoloe` 搜索 API 只读快照。
- `distribution-evidence/coco-terms.json`：COCO 官方条款正文及摘要。
- `../../2026-09-13-2d-model-compatibility/sources.lock.json`：上游 commit、权重字节数和 SHA256 的既有锁定记录。
