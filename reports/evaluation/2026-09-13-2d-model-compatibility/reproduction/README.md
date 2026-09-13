# SOD 转换复现

从仓库根目录准备固定权重和 PaddleDetection commit 后，按 `sources.lock.json` 校验字节数与 SHA-256。权重 URL：`https://paddledet.bj.bcebos.com/models/ppyoloe_plus_sod_crn_l_80e_coco.pdparams`；源码归档：`https://github.com/PaddlePaddle/PaddleDetection/archive/b25522a0f4bde8c80603f3ba5e3472059972e3b5.zip`。

使用 Python 3.11 环境运行 `export_sod.py` 完成官方导出和 Paddle2ONNX 转换，再运行 `prepare_sod.py`。两个脚本会校验固定输入和原始图 SHA-256；`summarize.py` 依赖同一固定 COCO 子集与已生成的预测文件。完整结果和环境见上级目录的 `ppyoloe-sod-conversion.md` 与 `evidence-index.json`。
