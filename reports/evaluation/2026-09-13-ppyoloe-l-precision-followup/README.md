# PP-YOLOE+ L 640 精度误差复查

日期：2026-09-13。实验复用普通 PP-YOLOE+ L 640 FP32 候选、固定 COCO val2017 64 张图片和上一轮逐框比较口径。目标是确认仅保留检测头为 FP32 是否能恢复 FP16/W8A32 与 FP32 的逐框一致性。

## 结果

| 变体 | 保留 FP32 的节点 | 文件大小 | 参考框匹配率（IoU≥0.99、score≥0.5） | 结论 |
| --- | --- | ---: | ---: | --- |
| FP16 检测头复查 | `Conv.100`–`Conv.129` | 104,713,272 bytes | 85.6% | 与原 FP16 的 85.0% 基本相同 |
| W8A32 检测头复查 | `Conv.100`–`Conv.129` 不量化 | 95,612,180 bytes | 88.7% | 比原 W8A32 的 6.3% 有改善，仍低于 95% |
| W8A32 扩大保留范围 | `Conv.90`–`Conv.129` 不量化 | 106,656,240 bytes | 89.7% | 体积增加但收益有限，仍低于 95% |

三组实验均在 Python ONNX Runtime CPU 上完成 64 图推理；源模型 SHA-256 为 `01f325d228676b0494e5eec45f10e2830dc9f81bf67a03157c24a0abf7824075`。实验模型和预测文件保存在本机临时目录，不进入发布清单。

## 判定

仅保留检测头不能使 FP16/W8A32 达到当前稳定门槛。继续扩大 FP32 保留范围会削弱体积优势，暂不进入稳定 manifest、Demo 或门户登记。下一次复查需要基于算子级误差定位或重新训练/校准量化，而不是继续盲目扩大排除节点列表。

## 复现命令

```powershell
$py = '.tmp/phase2/venv/Scripts/python.exe'
python tools/model-pipeline/weight_only.py --input <l-fp32.onnx> --output <w8a32-headfp32.onnx> --sha256 01f325d228676b0494e5eec45f10e2830dc9f81bf67a03157c24a0abf7824075 --report <report.json> --exclude-node Conv.100 --exclude-node ... --exclude-node Conv.129
python tools/model-pipeline/ppyoloe/inference.py --model-kind ppyoloe --model <variant.onnx> --annotations reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json --images-dir .tmp/phase2/dataset/images --predictions <predictions.json> --report <runtime.json>
```

