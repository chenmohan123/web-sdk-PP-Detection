# PicoDet 全系列精度候选转换报告

日期：2026-09-15。输入为 `reports/evaluation/2026-09-14-picodet-series/jobs.json` 中八个规格的已发布 FP32 图。本轮 jobs 的 `sourceModel/sourceBytes/sourceSha256` 固定该稳定 FP32 输入；更早的官方导出与浏览器修复过程见上一轮报告。

运行命令：

```powershell
$env:PYTHONIOENCODING='utf-8'; $env:PYTHONDONTWRITEBYTECODE='1'
& F:/git/00_chenmohan/github/web-sdk-PP-Detection/.tmp/phase2/venv/Scripts/python.exe reports/evaluation/2026-09-15-picodet-series-precision/prepare.py
```

结果：24 项 jobs（8 规格 × FP32/FP16/W8A32），16 个候选写入 `.tmp/picodet-series-precision`。FP16 复用 `float16_models.py` 的 PicoDet 配置并保留 `Cast_5`；W8A32 复用 `weight_only.py`，排除实际存在的 `Conv_0`、`Conv_1`，激活与卷积计算保持 FP32。每个候选均记录源/输出字节数和 SHA-256，候选清单状态为 `labs`。

转换器对每个输出执行 ONNX full check、有限值检查和输入输出 dtype 检查；W8A32 还记录量化权重数量、跳过项和误差。转换期间 ORT 仅报告清理未使用 initializer 的警告，无转换失败项。桌面浏览器矩阵与质量门槛由 Task 2 执行，本报告不宣称候选已达标。

16 份详细转换记录原样归档在 `conversions/`，`conversion-index.json` 记录逐文件大小和 SHA-256；保留转换器版本、算子保留配置及量化明细。清理 `.tmp` 不影响阅读这些记录。质量门槛结果由同目录 `summary.json` 和三轮原始归档提供。

修复记录：实验清单的候选变体使用 `custom` 本地评测来源，URL 为评测服务 `http://127.0.0.1:4173/<filename>`，revision 为候选 SHA-256，不表示远端发布。恢复转换会核验源与候选的 bytes/SHA、精度、`Cast_5` 或 `Conv_0`/`Conv_1` 配置及 conversion 报告；本轮 16 个已有候选身份一致，因此未重转。FP32 jobs 的 `sourceModel/sourceBytes/sourceSha256` 已统一指向固定稳定 FP32 本身。真实 ORT 推理使用 XS-320 FP16 和全零 `[1,3,320,320]` 输入，输出形状为 `[(82,6),(1,)]`，浮点输出均为有限值。
