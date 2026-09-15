# PicoDet 全系列 FP16 / W8A32 对比与发布

日期：2026-09-15。新增 8 个规格、16 个精度候选已完成三轮桌面 WASM/WebGPU，共 144 组固定 64 图评测。14 个候选满足识别门槛，发布到 ModelScope 和 Hugging Face；其余保留 labs 证据。已有 PicoDet L-320 三精度不重做。

默认仍为 PicoDet L-320、FP32、ModelScope；SDK/npm 保持 0.4.0，新增模型清单独立版本为 1.0.1。模型来源只提供 ModelScope 和 Hugging Face，显式选择失败不静默换源。

## 质量门槛

每个候选仅与同规格、同后端、同轮 FP32 对比：AP 下降≤0.5 个百分点；score≥0.5、同类 IoU≥0.5 一对一检测保留率≥95%。每个候选的六组对比全部满足才通过。IoU≥0.99只诊断坐标偏差，不阻塞发布。固定 COCO 子集为64图、716标注，不代表全量COCO成绩。

| 规格           | 精度  | 文件 MB | 体积减少 | 最低 AP 变化（点） | 最低保留率 | 状态         |
| -------------- | ----- | ------: | -------: | -----------------: | ---------: | ------------ |
| picodet-l-416  | FP16  |   14.84 |    36.2% |             -0.018 |     98.51% | 稳定发布     |
| picodet-l-416  | W8A32 |    6.14 |    73.6% |             -0.208 |     99.11% | 稳定发布     |
| picodet-l-640  | FP16  |   14.87 |    36.2% |             -0.011 |     97.85% | 稳定发布     |
| picodet-l-640  | W8A32 |    6.19 |    73.4% |             +0.184 |     97.14% | 稳定发布     |
| picodet-m-320  | FP16  |    8.87 |    36.2% |             +0.026 |     99.23% | 稳定发布     |
| picodet-m-320  | W8A32 |    3.74 |    73.1% |             +0.393 |     98.47% | 稳定发布     |
| picodet-m-416  | FP16  |    8.89 |    36.2% |             +0.008 |     97.05% | 稳定发布     |
| picodet-m-416  | W8A32 |    3.75 |    73.0% |             +0.447 |     97.35% | 稳定发布     |
| picodet-s-320  | FP16  |    3.08 |    35.9% |             -0.338 |     99.53% | 稳定发布     |
| picodet-s-320  | W8A32 |    1.38 |    71.3% |             +0.640 |     98.58% | 稳定发布     |
| picodet-s-416  | FP16  |    3.10 |    35.8% |             -0.342 |    100.00% | 稳定发布     |
| picodet-s-416  | W8A32 |    1.40 |    71.0% |             +0.258 |     97.21% | 稳定发布     |
| picodet-xs-320 | FP16  |    1.86 |    35.4% |             +0.063 |     98.12% | 稳定发布     |
| picodet-xs-320 | W8A32 |    0.88 |    69.6% |             +0.072 |     94.38% | labs，未发布 |
| picodet-xs-416 | FP16  |    1.88 |    35.4% |             +0.027 |     98.53% | 稳定发布     |
| picodet-xs-416 | W8A32 |    0.90 |    69.1% |             +0.468 |     94.12% | labs，未发布 |

FP16保留敏感算子FP32，W8A32仅把权重存储压缩为INT8，激活和卷积仍为FP32。体积减少独立计为优势，不推导内存同比减少或推理普遍加速。

## 本机耗时

每组排除首图，取63张图片推理耗时的中位数，再取三轮中位数。网络下载不计入下表，原始记录另有加载、首图和端到端耗时。

| 规格           | 精度  | WASM 热推理 ms | WebGPU 热推理 ms |
| -------------- | ----- | -------------: | ---------------: |
| picodet-xs-320 | FP32  |          64.10 |            36.69 |
| picodet-xs-320 | FP16  |          66.33 |            34.02 |
| picodet-xs-320 | W8A32 |          64.25 |            37.85 |
| picodet-xs-416 | FP32  |         104.80 |            38.68 |
| picodet-xs-416 | FP16  |         103.60 |            35.99 |
| picodet-xs-416 | W8A32 |         101.82 |            41.36 |
| picodet-s-320  | FP32  |          87.43 |            34.38 |
| picodet-s-320  | FP16  |          91.59 |            33.37 |
| picodet-s-320  | W8A32 |          85.57 |            36.98 |
| picodet-s-416  | FP32  |         144.36 |            36.81 |
| picodet-s-416  | FP16  |         141.33 |            35.90 |
| picodet-s-416  | W8A32 |         140.24 |            40.89 |
| picodet-m-320  | FP32  |         188.86 |            35.11 |
| picodet-m-320  | FP16  |         183.08 |            35.22 |
| picodet-m-320  | W8A32 |         189.19 |            40.12 |
| picodet-m-416  | FP32  |         308.64 |            37.10 |
| picodet-m-416  | FP16  |         306.13 |            36.54 |
| picodet-m-416  | W8A32 |         309.08 |            40.85 |
| picodet-l-416  | FP32  |         466.18 |            37.06 |
| picodet-l-416  | FP16  |         447.39 |            36.17 |
| picodet-l-416  | W8A32 |         448.31 |            41.79 |
| picodet-l-640  | FP32  |        1046.50 |            43.66 |
| picodet-l-640  | FP16  |        1028.99 |            43.09 |
| picodet-l-640  | W8A32 |        1037.30 |            49.50 |

Windows 11 10.0.26200、Intel Core i5-10400F、Chromium 153.0.8010.12、ORT Web 1.27.0、物理NVIDIA Blackwell。WASM单线程，主线程模式，无SDK后端回退。第三轮未并发构建、上传或其他推理。未新增手机、WebNN/NPU或其他浏览器兼容声明；未测峰值内存。

## 证据与复现

`quality-receipt.json` 在完整离线复算后生成，绑定汇总、协议、清单、归档及质量计算脚本摘要。发布入口拒绝复算后修改的证据、替换过的最终权重、多余暂存文件、缺少或身份不符的双源回读记录。16 份详细转换报告保存在 `conversions/`，摘要见 `conversion-index.json`。

`inputs.lock.json`固定模型、清单、SDK、标注、64图摘要和环境；`artifact-index.json`固定288份压缩结果和轮次绑定。复算校验每组3轮的SHA与时间互异且递增，GPU身份一致；任何错后端、错精度、缺图、错SHA或协议参数变化都会失败。

使用已安装 `tools/model-pipeline/evaluation/requirements.txt` 的Python环境运行：

```powershell
python reports/evaluation/2026-09-15-picodet-series-precision/quality.py
python -m unittest discover -s reports/evaluation/2026-09-15-picodet-series-precision -p test_quality.py -v
```

首次归档加 `--archive`，从 `.tmp/picodet-series-precision/round-N` 读取真实结果。归档后复算无需ONNX与原图片。完整运行需同SHA权重、SDK bundle和64图，设置 `PICODET_IMAGE_ROOT` 与 `PLAYWRIGHT_BROWSERS_PATH` 后运行 `node reports/evaluation/2026-09-15-picodet-series-precision/browser.mjs`。

发布权重/元数据完整回读见 `weights-downloads.json` 与 `metadata-downloads.json`，浏览器双源下载、SHA/CORS和推理见 `remote-smoke.json`，最终清单主线程与Worker取消/恢复/释放见 `lifecycle-published.json`。所有证据只对记录日期、环境和文件身份有效。
