# PP-YOLOE FP16 可行性评测

日期：2026-09-12。结论：保留已发布的 FP32 默认模型。FP16 定向修正候选的文件体积减少 49.8%，本机没有测得有说服力的推理加速，状态继续为 labs，不接入稳定 Demo，也不发布新 npm 版本或模型资产。

## 候选与结果

使用原先固定的 COCO val2017 64 张图片、716 个标注。AP 按 0–100 展示，指标由官方 `pycocotools.COCOeval` 计算；这不是全量 COCO 成绩，也不能据少量 AP 上升认定 FP16 更准确。

| 变体                            | 文件大小（十进制 MB） | Python CPU AP | 浏览器 WASM AP | 浏览器 WebGPU AP | 结论                          |
| ------------------------------- | --------------------: | ------------: | -------------: | ---------------: | ----------------------------- |
| 已发布 FP32                     |                31.954 |       43.3499 |        43.4265 |          43.4265 | 稳定基线                      |
| 默认 FP16 转换                  |                16.053 |       43.3248 |        43.3900 |           0.0174 | WebGPU 数值错误，拒绝接入     |
| FP16，4 个 ReduceMean 保留 FP32 |                16.055 |       43.3254 |        43.4031 |          43.8597 | 可继续评估体积收益，保持 labs |

Python FP32 精度引用 [2026-09-11 相同 Pillow 输入路径](../2026-09-11-ppyoloe/ppyoloe-pillow-coco.json)，只用于质量对照；本次不比较历史与当前 Python 耗时。浏览器数据均来自本日，同样的 JPEG、SDK 预处理和后处理。Python/浏览器解码仍有历史报告记录的像素差异，不将两种输入的差异归因为精度转换。

WebGPU 阈值 0.5、同类别 IoU ≥ 0.5 一对一匹配中，FP32 有 443 个检测，修正候选有 449 个，匹配 441 个；FP32 未匹配 2 个，候选未匹配 8 个。匹配对最大置信度差 0.017865、框坐标最大差 6.266 像素。候选仍存在阈值附近的增减框，详见 [匹配记录](webgpu-mixed-parity.json)。

## 性能

本机 Windows 11 `10.0.26200`、Intel i5-10400F、NVIDIA Blackwell 物理适配器，Chromium `153.0.8010.12`、ONNX Runtime Web `1.27.0`、SDK `0.3.0`。GPU 具有 `shader-f16`；没有软件适配器、整次后端回退或自定义浏览器启动参数。主线程、batch 1、WASM 单线程、跨域隔离开启。ORT 会将部分节点放到 CPU，原始警告保留在 runtime 报告。

三轮候选与三轮 FP32 交替运行，每轮新建浏览器和会话并顺序检测 64 张图片。热值排除每轮首张；下表为三轮统计量的中位数。所测冷启动不含公网下载：模型由本机服务提供并以字节传入 SDK。端到端计时包含图片解码、预处理、推理、后处理，不含测试工具获取图片的网络请求。

| WebGPU 指标    |       FP32 |  修正 FP16 |
| -------------- | ---------: | ---------: |
| 会话创建       | 1137.36 ms | 1064.69 ms |
| 首张端到端     | 1366.01 ms | 1403.27 ms |
| 热推理中位数   |   48.91 ms |   48.68 ms |
| 热推理 P90     |  117.28 ms |  117.91 ms |
| 热预处理中位数 |   52.24 ms |   54.17 ms |
| 热端到端中位数 |  112.34 ms |  114.38 ms |
| 热端到端 P90   |  174.07 ms |  179.96 ms |

热推理只减少约 0.47%，端到端增加约 1.81%，不足以认定加速。WASM 各运行一轮，FP32 / 修正 FP16 热推理为 842.28 / 850.41 ms，端到端为 898.36 / 912.33 ms，同样没有显示速度收益。原始错误 FP16 的较短 GPU 时间不能用作优化成绩。

[summary.json](summary.json) 保留全部 15 轮运行、各轮 AP、计时、环境和预测引用。最初的三轮默认 FP16/FP32 是定位期测量，最终性能表只取 `webgpu-mixed-1..3` 与随后交替的 `webgpu-fp32-4..6`。相同预测按内容 SHA-256 去重归档；每轮均保留 runtime 记录，不把推理完成的 `status: passed` 当作精度验收通过。

## WebGPU 异常与定向修正

默认 FP16 转换在 CPU、WASM 上能给出正常结果，WebGPU 对 64 张不同图片产生同一组置信度序列，三轮均重现。模型前两层的输入 Cast、卷积及归一化仍随输入变化；首个 `ReduceMean` 出现非有限数值，紧随其后的 `HardSigmoid` 全为零，后续特征失去输入差异。

[最小复现](diagnostics/minimal-mean-webgpu.json) 只包含 Cast → ReduceMean → Cast。对 `[1,3,640,640]` 全一输入，FP16 路径输出非有限值，FP32 路径正确输出 `[1,1,1]`；全零输入两者均为零。这与半精度归约累积溢出一致。证据限于上述 ORT/浏览器/GPU 组合，不推断其他 GPU 或 ORT 版本必然相同。

在转换器默认排除列表基础上只增加 `ReduceMean`，保留四个均值归约节点为 FP32，其余转换方式保持一致，WebGPU 质量恢复。输入输出仍是 FP32（检测数量为 INT32），不需要改 SDK 预处理或返回值契约。初始及修正模型均通过完整 ONNX 校验；所有 initializer 与节点属性常量均为有限值。两种候选重新转换的 SHA-256 与原产物相同。

| 产物          | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| 原始稳定 FP32 | `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c` |
| 默认 FP16     | `6b465c33ce1e31431bd8ff0024e61b3b5c91b471ffdbb8547a3e0ab3fce823d9` |
| 修正 FP16     | `c5f9cca5475b481132f5169b80a647966503f3ccf9c4e86c26aef76123df3fd4` |

转换参数、工具版本、全部常量类型计数分别见 [默认转换](conversion-default.json)和[修正转换](conversion-reduce-fp32.json)。该计数不代表模型参数量。候选清单中的 WASM/WebGPU 是实验请求矩阵，不是新增发布兼容性承诺。

## 复现

从仓库根目录执行，沿用 [PP-YOLOE 指南](../../../tools/model-pipeline/ppyoloe/README.md)准备的源模型与 64 张图片。Python 环境含 ONNX 1.16.2、ONNX Runtime 1.20.1、NumPy 1.26.4 及原评测依赖。以下输出使用独立目录，转换器拒绝覆盖已有模型。

```powershell
$probe = '.tmp/fp16-reproduction'
$python = '.tmp/phase2/venv/Scripts/python.exe'
$evidence = 'reports/evaluation/2026-09-12-ppyoloe-fp16'
& $python "$evidence/diagnostics/convert.py" --source .tmp/phase2/ppyoloe-plus-s-candidate.onnx --output "$probe/model.onnx" --keep-reduce-fp32
node "$evidence/diagnostics/prepare-browser.mjs" "$probe/model.onnx" $probe
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path .tmp/dependencies-compatible-browsers).Path
node "$probe/browser-probe.mjs" --model "$probe/model.onnx" --manifest "$probe/manifest.json" --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --image-root .tmp/phase2/dataset/images --backend webgpu --output "$probe/webgpu.json"
```

去掉 `--keep-reduce-fp32` 可复现默认转换候选；将后端改为 `wasm` 可复现其 CPU 浏览器路径。性能复测应关闭其他测试/构建/推理任务，交替至少三轮并单列首张和会话。

诊断脚本是本次定位的实验快照，使用固定的 `.tmp/fp16-2026-09-12` 布局。若需复现中间层诊断，将 `diagnostics/prepare-stem.py` 复制到该临时目录并准备本次两个候选、清单；依次运行 `prepare-stem.py`、`prepare-reductions.py` 和 `stem-browser.mjs reductions`。`prepare-reduce-fp32.py` 生成最小均值图，`stem-browser.mjs minimal-mean-fp16 minimal-mean-fp32` 直接调用 ORT 复现溢出。脚本没有发布用途，权重、图像和临时 ONNX 不提交。

## 后续验证清单

- 小米 15 尚未验证本次 FP16；先前 CPU/GPU 反馈仅覆盖已发布 FP32。记录系统、浏览器、实际后端和 FP16 身份后，再验证初始化、重复检测和与 FP32 对照。
- 在含小目标、密集、暗光场景的更大数据集复核增减框、AP 与阈值稳定性，再决定是否分发。
- 比较手机上的文件下载、会话加载、热推理及端到端耗时；本次文件减半不等于显存/峰值内存减半，尚未测峰值内存。
- 若以加速为目标，优先分析约 52 ms 的 CPU 预处理和 GPU/CPU 节点交互；本轮没有将这两项扩大为新的实现任务。

本轮没有上传候选、改稳定模型清单或重发 0.3.0；默认转换的失败记录保留，后续接入须使用独立模型版本和不可变来源。
