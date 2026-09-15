# 三轮评测实现记录

`browser.mjs` 调用 `runner.mjs`，逐条核验 inputs.lock.json 固定的模型、清单、SDK、标注、图片及环境身份。已有通过记录必须保留原始绑定并重新校验，失败记录保留到本地 failed 目录，遇到新失败立即停止。

`summarize.py` 调用 `quality.py`，使用官方 pycocotools.COCOeval 和 evaluation.compare_detections 复算 AP 与同类一对一检测保留率。每个变体与同轮同后端 FP32 比较，六组全通过才达标。`--archive` 写入 gzip 和 artifact-index，归档后复算无需模型与原图。

实际 Python 依赖为主 SDK 的 `.tmp/phase2/venv/Scripts/python.exe`，没有伪匹配或缺依赖降级。`test_quality.py` 用真实 FP32 记录的内存副本检验错误摘要、后端、精度、参数、缺图、重复图片、错误绑定、重复 jobs、类别/IoU/score、一对一匹配及 Python 优化模式。最终数量和结论见 summary.json。
