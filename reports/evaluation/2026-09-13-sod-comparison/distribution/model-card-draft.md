# PP-YOLOE+ SOD L 640 COCO 模型卡草稿

状态：`selected` 本地评测候选，未正式分发。日期：2026-09-13。

## 模型与来源

PaddleDetection 的 PP-YOLOE+ SOD L 用于轴对齐 2D 单帧目标检测，输出 COCO 80 类。固定上游 [PaddleDetection b25522a](https://github.com/PaddlePaddle/PaddleDetection/tree/b25522a0f4bde8c80603f3ba5e3472059972e3b5)，配置为 `configs/smalldet/ppyoloe_plus_sod_crn_l_80e_coco.yml`。官方配置引用 Objects365 预训练权重，随后在 COCO train2017 上训练、val2017 上评估。

原始权重 [官方下载](https://paddledet.bj.bcebos.com/models/ppyoloe_plus_sod_crn_l_80e_coco.pdparams)，351,463,346 bytes，SHA-256 `6982308d871e0d4285dc8577814409b077ef947fef9d59ef6497b86f9f153e87`。

## 转换产物与契约

Paddle 2.6.2、Paddle2ONNX 1.3.1、ONNX opset 11、FP32。固定 batch=1、scale_factor=[[1,1]]，修正两处 NMS 索引 Squeeze 轴。转换流程和完整参考对齐见 [转换证据](../../2026-09-13-2d-model-compatibility/ppyoloe-sod-conversion.json)。

ONNX 345,644,377 bytes，SHA-256 `a8fb0978485d42f78346339490302e4f3116daa2cdc7c192b2e2250b1675cd2e`。输入 float32 `image:[1,3,640,640]`；输出 float32 `[N,6]`（类别、分数、x1、y1、x2、y2）及框数量。RGB、拉伸 640、bicubic、除 255，输出为输入像素坐标，SDK 映射回原图。

## 验证与局限

2026-09-13 已验证 Chromium 153、ORT Web 1.27.0 的 WASM/WebGPU；SOD 主线程/Worker 生命周期已通过。没有声明其他浏览器、手机、所有 GPU 或低精度变体兼容。

同一 64 图场景子集，SOD 浏览器 AP=51.72、AP small=39.37；普通 L 对照为 51.31、39.06。体积增加 65.24%，本轮决定暂不优先稳定接入。完整设置、设备、耗时与限制见 [对照报告](../README.md)。

## 许可与分发状态

固定上游代码许可证为 [Apache-2.0](https://github.com/PaddlePaddle/PaddleDetection/blob/b25522a0f4bde8c80603f3ba5e3472059972e3b5/LICENSE)。当前证据未明确权重的许可适用范围，因此尚未为权重填写肯定的发布许可字段。正式分发前留存适用许可依据，附上游 LICENSE、署名和转换改动说明。

训练数据归因：COCO Consortium；[COCO 条款](https://cocodataset.org/#termsofuse) 区分 CC BY 4.0 标注、原作者图片权利和软件条款。模型包不包含训练/评测图片或标注。

ModelScope 默认来源和 Hugging Face 镜像均尚未建立本模型的正式固定 revision。取得分发依据并决定接入后，为同一 ONNX 准备两端固定 revision、路径、字节数、SHA-256 和实际下载证据；本草稿不提供未验证的公开模型 URL。
