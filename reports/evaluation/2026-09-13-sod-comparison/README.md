# SOD L 与普通 PP-YOLOE+ L 对比及接入决策

日期：2026-09-13。SDK 基线 `28db99e`，本轮不修改 runtime、稳定 manifest、Demo 或 npm 版本。

## 结论

两模型均已完成普通桌面真实推理与数值核验。本轮**暂不优先将 SOD L 接入稳定模型**：相同 L 规模、640 输入和 64 图下，SOD 的浏览器小目标 AP 仅比普通 L 高 **0.32 个百分点**，模型却增加 **65.24%**；中、大目标 AP 分别低 1.09 和 1.55 个百分点。Python 官方预处理下的小目标提升也只有 0.17 个百分点。样本不足以证明统计显著性，也不否定 SOD 在无人机、密集小目标或更大输入上的价值。

SOD 保留 `selected`：表示转换和桌面契约已通过，正式接入顺序暂缓。普通 L 是本轮对照对象，也未成为公开稳定模型。后续优先评估普通 PP-YOLOE+ L 的体积优化和质量档价值；SOD 在有代表性的密集小目标样本显示更充分收益、并补齐权重许可适用范围与固定分发来源后再恢复接入。

## 固定口径

使用同一 PaddleDetection commit `b25522a0f4bde8c80603f3ba5e3472059972e3b5`、FP32、640 × 640、batch=1。官方图内 NMS 一致：分数阈值 0.01、IoU 0.7、每类候选 1000、最终保留 300。SDK 评测阈值为 0.001、二次 NMS IoU 为 1；图内 0.01 仍是实际输出下限。无切片、无小目标增强。

复用 2026-09-11 预先固定的 COCO val2017 场景子集：64 张图、716 条标注，其中 399 个非 crowd 小目标，分布在 40 张图。使用官方 COCOeval bbox、原始类别 ID、maxDets=[1,10,100]。这不是完整 COCO mAP。

Python 分别采用 OpenCV INTER_CUBIC 与 Pillow BICUBIC。浏览器使用同一原 JPEG 解码像素生成的无损 PNG，再走 SDK 的 bicubic；64 组 JPEG/PNG 的像素相等已核验，并固定双份摘要。浏览器质量与 Pillow 参考比较，解码耗时对应 PNG。详见 [协议](protocol.md) 和 [输入锁](inputs.json)。

## 质量与体积

AP 按百分制显示，JSON 保留 0～1 原值。

| 模型 / 预处理与后端          | ONNX 体积 |    AP |  AP50 |  AP75 | AP small | AP medium | AP large |
| ---------------------------- | --------: | ----: | ----: | ----: | -------: | --------: | -------: |
| 普通 L / Python OpenCV       | 209.18 MB | 51.37 | 68.33 | 56.61 |    38.91 |     64.86 |    82.85 |
| SOD L / Python OpenCV        | 345.64 MB | 51.65 | 69.54 | 55.08 |    39.08 |     63.48 |    81.38 |
| 普通 L / WebGPU，Pillow 对齐 | 209.18 MB | 51.31 | 68.51 | 56.17 |    39.06 |     64.70 |    82.91 |
| SOD L / WebGPU，Pillow 对齐  | 345.64 MB | 51.72 | 70.36 | 54.88 |    39.37 |     63.60 |    81.36 |

两模型的 WebGPU 指标分别与自身 Pillow Python 指标一致。WASM 的 8 图仅用于可用性和速度核验，不与 64 图 AP 混排。

## 本机代价

Windows 11 x64（10.0.26200）、Intel Core i5-10400F、Chromium 153.0.8010.12、SDK 0.4.0、ORT Web 1.27.0。WebGPU 实测适配器 `nvidia / blackwell / isFallbackAdapter=false`；浏览器隐藏具体设备名，不推测显卡型号。Python 3.11.15、ORT 1.20.1、CPUExecutionProvider、4 线程；浏览器 main 模式、WASM 1 线程、关闭缓存与回退。未测内存峰值。

| 模型 / 环境     | 样本数 | 会话创建 | 首图总耗时 | 热推理中位数 | 热总耗时中位数 | 热总耗时 P90 |
| --------------- | -----: | -------: | ---------: | -----------: | -------------: | -----------: |
| 普通 L / WebGPU |     64 |  1579 ms |    2743 ms |     63.43 ms |       99.09 ms |    144.57 ms |
| SOD L / WebGPU  |     64 |  2190 ms |    3380 ms |     72.35 ms |      106.16 ms |    156.38 ms |
| 普通 L / WASM   |      8 |   644 ms |    4861 ms |      4643 ms |        4680 ms |      4791 ms |
| SOD L / WASM    |      8 |  1003 ms |    6038 ms |      5876 ms |        5913 ms |      6006 ms |

热统计排除首图；总耗时包含解码、预处理、推理、后处理，不含模型获取和会话创建。四次浏览器运行顺序执行，没有并行推理；这是每配置一次运行的观测，冷启动只有一个样本。WebGPU 内部仍可能有 shape 节点运行在 CPU，SDK 没有切换后端。CPU OpenCV 热推理中位数分别为 458.00 和 577.93 ms，不能与 WASM 或 GPU 混作同一后端排名。

WASM 两者均达到秒级，后续 Demo 集成应优先 Worker；本轮不重复修改调度器，沿用 [SOD 四组合生命周期证据](../2026-09-13-2d-model-compatibility/ppyoloe-sod-lifecycle.json)。该历史记录只证明其记录的 SOD 对象，普通 L 的 Worker 尚未单独验证。手机不作为本轮门槛，仍明确未验证。

## 转换与逐框核验

普通 L 使用官方 Paddle 2.6.2 导出、Paddle2ONNX 1.3.1 opset 11 转换，复用已有的严格 NMS 修正工具；不修改上游代码。原图 `afd9c57b386a7b6c7c6b6d44aa6b383a9d537fc39b65cf6e5ddc2054e99cab4d`，修正图 `01f325d228676b0494e5eec45f10e2830dc9f81bf67a03157c24a0abf7824075`，209,181,400 bytes。修正限定为两个 Squeeze 轴、固定 batch 和 scale_factor，与已验证的普通 S 转换拓扑相同。

- 普通 L Paddle→ONNX：64 图、533 个 score≥0.5 框全部匹配，IoU≥0.99，最大坐标分量差 0.000184 像素；两侧 AP 差约 0.00036 个百分点。
- 普通 L Pillow→WebGPU：64 图、538 个框全部匹配；SOD 为 530 个框全部匹配。
- 普通 L Pillow→WASM：8 图、53 个框全部匹配；SOD 为 49 个框全部匹配。
- 所有比较均无未匹配框，完整分数/坐标误差见 [summary.json](summary.json)。框数差异与预处理有关，不在不同预处理之间套用同一参考。

## 分发与后续

[分发审查](distribution/distribution-review.md) 已核实固定源码的 Apache-2.0 和官方权重链接。权重许可适用范围尚待补证；本轮平台搜索也未建立可直接使用的官方 SOD 镜像，正式 ModelScope/Hugging Face 固定 revision 和下载完整性证据仍未产生。保持 ModelScope 默认方向，后续镜像使用同一 ONNX，不将模型二进制打包进 npm。

下一阶段优先评估普通 L 的 FP16/W8A32 体积、识别保持程度和桌面代价，再决定是否作为新的质量档。SOD 的复查条件为：更有代表性的小目标集显示值得承担额外体积的收益，或低精度变体显著减轻成本，同时完成分发证据。进入面向移动端的发布范围时再按风险安排手机复核。

## 证据与复现

[run_comparison.ps1](run_comparison.ps1) 使用现有锁定 Python 环境与上游缓存顺序重跑转换、参考、浏览器和汇总；[复现说明](reproduction.md) 说明输入准备。模型和图片留在忽略目录 `work/` 或复用的 `.tmp/` 中。

[evidence-index.json](evidence-index.json) 固定 22 份原始与压缩证据的双重摘要。仅使用已提交 JSON、压缩预测和 pycocotools 即可重算：

```powershell
python reports/evaluation/2026-09-13-sod-comparison/summarize.py --verify-only
```

标准检查、SDK 206 项单测、构建、文档校验及离线证据核验结果见 [verification.md](verification.md)。
