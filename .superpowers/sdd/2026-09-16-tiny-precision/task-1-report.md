# Task 1：Tiny 精度转换与质量门禁报告

日期：2026-09-16。工作树：`codex/tiny-precision`。

## 状态

已完成真实转换、CPU 基础有效性对照、18 组串行浏览器评测、逐轮 AP/一对一匹配/热推理复算、gzip 归档和边界测试。FP16 通过质量门槛；W8A32 未通过 AP 门槛，保留 labs，不能发布。SDK build 未执行，复用了已锁定且未变化的 SDK dist（SHA-256 `c2b6a9733416571c77c8dc48fa68028251e5d8cccb201047c8387bf9433e1189`）。

## 关键产物

- 评测目录：`reports/evaluation/2026-09-16-tiny-precision/`
- 临时模型和原始记录：`.tmp/tiny-precision/`
- `jobs.json`：FP32/FP16/W8A32 三项身份。
- `protocol.json`：固定 64 图、3 轮、WASM/WebGPU 与门槛。
- `inputs.lock.json`：协议、jobs、SDK、模型、manifest、标注、图片集、浏览器/运行时/GPU 身份。
- `evidence/` 与 `artifact-index.json`：18 组 gzip 原始证据及压缩前后摘要。
- `summary.json`：逐轮、逐后端 AP、保留率、严格诊断、热推理中位数和逐变体判断。
- `README.md`：中文复现入口、表格、边界和限制。

## 转换记录

源模型为 `.tmp/candidate-2d-20260915/ppyolo-tiny-320-fp32.onnx`，4,511,117 字节，SHA-256 `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653`，opset 14，输入 `float32 [1,3,320,320]`，输出为 float32 检测与 int32 计数。

FP16 复用 `float16_models.py`，Tiny 专属保留 `Exp.0/Exp.2/Exp.4` 为 FP32，原因是三尺度解码指数会直接影响框尺度；输出 2,357,376 字节，SHA-256 `331cef176e8af2eacd9bfc6d011ade2d29cd41f013af2db2c716566e035413cc`。W8A32 复用 `weight_only.py`，保留 `Conv.0` 至 `Conv.4` 输入 stem 以及 `Conv.80/Conv.81/Conv.82` 三个检测头，原因是低层纹理和分类/回归输出对权重量化更敏感；输出 1,573,135 字节，SHA-256 `9317cbfaf2f36b22430f1cf12c3bd00289458c3878aa3a9d1b34131264b99b53`。两者均通过 `onnx.checker.check_model(full_check=True)`、有限权重检查、输入输出契约检查和 CPU ORT 单零输入推理；两项输出均为有限值，形状分别为 `[1,6]` 与 `[1]`。

## 评测原始结果与门槛判断

使用固定 64 图、716 个标注、同后端 FP32 基线，三精度×两后端×三轮共 18 组全部 `passed`。FP16 六组最差 AP 变化 -0.174649 点，最低 score≥0.5 同类 IoU≥0.5 保留率 0.995192，门槛通过；W8A32 六组 AP 变化 -0.537364 点，最低保留率 0.966346，因 AP 超过 -0.5 点失败。FP16 严格 IoU≥0.99 最低保留率约 0.677885，仅作诊断。热推理中位数均从每组第 2 至第 64 张图计算，未把首图启动成本混入。

## 首次转换/运行异常及修复证据

首次运行因未设置 `PLAYWRIGHT_BROWSERS_PATH`，评测器查找 worktree 内不存在的 Chromium 可执行文件，6 组首轮记录为 `failed` 并保存在 `.tmp/tiny-precision/failed-browser-cache/`。随后显式使用任务指定的共享兼容浏览器缓存重跑同一 6 组，全部通过；没有替换模型、静默回退或修改门槛。

## 测试与自审

- `pytest reports/evaluation/2026-09-16-tiny-precision/test_quality.py reports/evaluation/2026-09-16-tiny-precision/test_prepare.py -q`：7 passed；覆盖缺失轮次/后端、重复 jobs、源摘要、模型/manifest/SDK/图片证据身份、非有限门槛、一对一匹配边界和 Tiny 专属节点。
- `summarize.summarize(True)`：18 条原始记录全部解压并逐条通过身份校验，写出 summary 与 artifact-index。
- `git diff --check`：提交前执行。

## 风险

本证据只支持固定桌面环境和固定 64 图，不能外推全量 COCO、手机、NPU 或其他浏览器。W8A32 体积缩减约 65.128% 是独立收益，不代表质量或速度收益；其 AP 门槛失败，必须保持 labs。FP16 体积缩减约 47.743%，质量门槛通过但仍需主代理后续发布审查，不能在本报告之外宣称已发布。

## 修复轮次1报告

主代理补齐独立审查4项拒绝检查：实际标注统一读入和验证，所有实际evaluation字段精确比较，全部图片耗时有限非负/保留率范围，CPU会话与报告完整三精度契约。新增validation.py与test_validation.py；原协议和全部18份gzip均未修改，补充协议单列supplemental-validation.json。

验证：phase2 Python -m pytest test_validation.py test_quality.py test_prepare.py -q -p no:cacheprovider，共13 passed（1.06s）；新增模块前测试因ModuleNotFoundError按预期失败。phase2 Python summarize.py退出0，重算对象与git show 4ebaecc的summary完全相同。三份真实ORT CPU会话验证输入image/float32/[1,3,320,320]及两个输出，零输入输出与已归档CPU记录完全相同；FP16仍有既有constant-folding警告，未影响推理/有限值。git diff --check通过。下一步针对4项修复独立定向复审，未上传任何权重。
