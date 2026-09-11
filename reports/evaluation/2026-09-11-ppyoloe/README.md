# PP-Detection 第二模型评测：PP-YOLOE+ S

日期：2026-09-11。基线为 `ccc115f`，本地分支 `codex/ppyoloe-evaluation-baseline`。本轮对应原规划的第二检测模型接入与质量评测阶段；PP-YOLOE+ S 640 FP32 保持本地 `labs` 候选。

结论：PP-YOLOE+ S 在本子集的浏览器 AP 比 PicoDet 高约 9.21 个百分点，适合作为偏重质量的可选模型。它的单线程 WASM 代价明显更高；WebGPU 是本机上更实用的执行方式。默认仍使用既有稳定模型，候选通过本地构建和显式 `allowExperimental: true` 启用。

## 数据与比较口径

COCO val2017 的 64 张预先固定图片，共 716 条标注。按人物、车辆、动物、小目标、密集目标和 crowd 场景分桶，用固定 SHA-256 种子选图，再补足数量。选择发生在模型推理之前。图片 ID、bbox 标注、文件哈希、原 COCO 图片许可和来源保存在 `dataset/`。

这是一份场景覆盖子集，不能当作全量 COCO mAP 或统计显著性证明。所有质量指标通过 `pycocotools.COCOeval` 的 bbox 模式计算，使用原始非连续 `category_id`，score 最低 0.001，官方 `maxDets=[1,10,100]`。PicoDet 图内 NMS 最多输出 100 项，PP-YOLOE 图内最多输出 300 项；COCOeval 按统一规则计算。SDK 后处理 IoU 设为 1，避免二次 NMS 收紧模型已输出的检测集合。

## CPU 质量与代价

| 模型与预处理            |    AP |  AP50 |  AP75 | AP small | AP medium | AP large | 热推理中位数 |
| ----------------------- | ----: | ----: | ----: | -------: | --------: | -------: | -----------: |
| PicoDet-L-320，Pillow   | 34.32 | 47.70 | 36.80 |    15.58 |     45.93 |    67.20 |     43.89 ms |
| PP-YOLOE+ S 640，OpenCV | 43.36 | 62.08 | 45.19 |    26.79 |     55.82 |    72.83 |    110.87 ms |
| PP-YOLOE+ S 640，Pillow | 43.35 | 62.00 | 45.84 |    26.97 |     56.14 |    71.38 |    113.67 ms |

表内 AP 按百分制展示；JSON 保留 0 到 1 的原值。CPU 为 Intel Core i5-10400F，Windows 11 Pro x64，Python 3.11.15、ORT 1.20.1、CPUExecutionProvider、4 个推理线程。每模型只创建一次 Session，先处理第一张，再统计其余 63 张的中位数和 P90；这是本机单次顺序运行观测。模型大小从 23,243,834 增至 31,954,220 字节。不能把该 CPU 数值直接用于浏览器 GPU 性能结论。

## 转换与参考核验

上游固定为 PaddleDetection `b25522a0f4bde8c80603f3ba5e3472059972e3b5`，配置 `configs/ppyoloe/ppyoloe_plus_crn_s_80e_coco.yml`。官方导出后使用 Paddle2ONNX 1.3.1 转换 opset 11。

原转换图在 ORT 创建 Session 时因 `Gather.8` 输入被挤为标量而失败。定向修复仅固定 image batch=1，将 `scale_factor` 固定为 `[[1,1]]`，以及把 NMS 类别/框索引列上的两个 Squeeze 约束为 `axes=[1]`。模型输出仍为 640 输入像素坐标，由 SDK 恢复到原图；修复工具在拓扑不符合预期时拒绝处理。

在相同 OpenCV 输入上运行原官方 Paddle 静态模型与 ONNX 候选：Paddle AP=43.358998，ONNX AP=43.360019；score≥0.5、同类 IoU≥0.99 下，443/443 检测一对一匹配，两侧均无未匹配项。最大分数差 `5.4240e-6`，最大 bbox 分量差 `0.0009919` 像素。见 `paddle-vs-onnx.json`。

官方 PP-YOLOE+ reader 使用 OpenCV `INTER_CUBIC`、RGB、stretch 640、除 255、mean=0/std=1。SDK 的 `bicubic` 使用 Pillow 算法。两者子集 AP 接近，但同一严格匹配阈值下仅 389/443 匹配，两侧各 54 项未匹配；不能宣称预处理逐框等价。浏览器一致性以 Pillow CPU 为参考。见 `opencv-vs-pillow.json`。

## 浏览器结果

正式 runner 通过 SDK 的 `createPPDetection()` 和 `detect()` 运行相同 64 张 JPEG。环境为 Windows 11、Chromium 153.0.8010.12、ORT Web 1.27.0；main 模式、WASM 线程数 1、缓存关闭、回退关闭。Chromium 无额外启用 GPU 的启动参数。物理适配器报告 `nvidia / blackwell / isFallbackAdapter=false`，device 和 description 被浏览器隐藏，保留 null。

| 模型 / 后端       |    AP |    Session | 首张总耗时 | 热推理中位数 | 热总耗时中位数 | 热总耗时 P90 |
| ----------------- | ----: | ---------: | ---------: | -----------: | -------------: | -----------: |
| PicoDet / WASM    | 34.22 |  434.59 ms |  393.27 ms |    269.41 ms |      309.09 ms |    333.08 ms |
| PP-YOLOE / WASM   | 43.43 |  431.88 ms |  991.71 ms |    856.71 ms |      918.09 ms |   1014.67 ms |
| PicoDet / WebGPU  | 34.22 | 1266.90 ms | 3541.38 ms |     38.30 ms |       77.93 ms |    109.52 ms |
| PP-YOLOE / WebGPU | 43.43 | 1173.93 ms | 2754.05 ms |     52.06 ms |      117.57 ms |    187.12 ms |

总耗时包含图片解码、预处理、推理和后处理，不包含模型下载及 Session 创建。热统计为同一 Session 下其余 63 张图片，排除首张；四次运行顺序执行，没有并行运行其他验证命令。每模型只有一次冷启动观测，不能据此断言冷启动时延排序。WebGPU 内部部分 shape 节点由 ORT 分配到 CPU，原始 warning 在报告中保留；这不等于 SDK 将整次推理回退为 WASM，也不能宣称全部算子在 GPU。

两个浏览器后端的 AP 相同。PP-YOLOE 的浏览器 JPEG 结果与 Pillow CPU 在 IoU≥0.99 下匹配 419/443 项；将同一批 JPEG 用 Pillow 解码为 RGBA，再以 SDK 的 `ImageRaster` 输入 WebGPU 后，443/443 项全部匹配，最大分数差 `6.3181e-6`、bbox 分量差 `0.0011597` 像素。该诊断定位了 JPEG 解码路径差异，见 `browser-raster-runtime.json` 和 `browser-raster-parity.json`，其中保留了每张原始 RGBA 的 SHA-256。

移动端、微信 WebView、其他浏览器和其他 GPU 尚未取得本轮证据。完整 COCO、FP16/INT8 以及公开分发仍是后续工作。

## 证据与复现

- `summary.json`：质量、性能汇总及预测文件哈希。
- `*-coco.json`：官方 COCOeval 输出，未定义指标为 null。
- `*-runtime.json`：模型摘要、环境和每图时间。
- `*-predictions.json.gz`：可解压重算的 COCO 预测；压缩文件和解压内容 SHA-256 均在 summary 中。
- `paddle-vs-onnx.json`、`opencv-vs-pillow.json`：逐图一对一匹配证据。
- `paddle-reference-runtime.json`：正式 Paddle CLI 的模型/标注摘要、逐图推理和对齐。
- `standard-before.json`、`standard-after.json`：修改前后标准检查快照。
- `verification.md`：验收命令、结果、局限及集成审查记录。

模型和 COCO 图片保存在项目 `.tmp/phase2/`，不进入 npm 或 Git。来源校验、环境、导出和评测完整命令见[复现指南](../../../tools/model-pipeline/ppyoloe/README.md)，本地使用见 [候选接入](../../../examples/ppyoloe-candidate/README.md)。正式导出工具已重新执行，从权重再次生成 ONNX 后得到相同候选 SHA-256 `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c`。

历史 `tools/model-pipeline/reports/1.0.1/variant-validation.json` 含 800×800、mask/reading-order 的其他模型记录，不用于本轮 PicoDet 或 PP-YOLOE 结论。本轮不涉及 FP16、INT8、远程模型分发或 npm/Pages 发布。
