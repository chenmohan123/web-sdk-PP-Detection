# W8A32 本地模型接入

本目录包含 PicoDet 和 PP-YOLOE 的 W8A32 实验产物。W8A32 表示卷积权重按输出通道保存为 INT8，激活与卷积计算保持 FP32；模型输出中的检测数量保持原有 INT32。状态为 labs。SDK/npm 不包含模型权重。

两个文件夹分别提供 ONNX、manifest.json、conversion.json。候选清单的 `precision: int8` 描述权重存储，实际策略见 `quantization: weight-only-int8-activation-fp32`；backends 按本地实测记录使用，不代表所有设备支持。

将某一模型的 ONNX 和 manifest.json 复制到应用的静态资源目录，比如 public/models/w8a32/，确保浏览器可读取。清单中的 localhost 来源仅供本地探针使用；下面按模型字节接入，会用清单中的字节数和 SHA-256 校验模型，不请求该来源地址。

```ts
import { createPPDetection } from "web-sdk-pp-detection";

const base = "/models/w8a32/";
const manifestResponse = await fetch(`${base}manifest.json`);
if (!manifestResponse.ok) throw new Error("模型清单读取失败");
const manifest = await manifestResponse.json();
const modelResponse = await fetch(`${base}${manifest.variants[0].filename}`);
if (!modelResponse.ok) throw new Error("模型读取失败");

const detector = await createPPDetection({
  model: { data: await modelResponse.arrayBuffer(), manifest },
  precision: "int8",
  allowExperimental: true,
  backend: "wasm", // 显式使用 GPU 时改为 webgpu。
  allowFallback: false,
  executionMode: "main",
  ort: { wasm: { paths: "/ort/", numThreads: 1 } }
});
try {
  const result = await detector.detect(imageFile);
  console.log(result.detections, result.model, result.runtime, result.timings);
} finally {
  await detector.dispose();
}
```

使用 `web-sdk-pp-detection@0.3.1`，其中 imageFile 为调用方选择的 File/Blob。`/ort/` 目录须提供对应 `onnxruntime-web@1.27.0` 的资源，可沿用 SDK Demo 的静态资源配置。WebGPU 要求 HTTPS 或 localhost，以及可用的物理 GPU/浏览器后端。

PicoDet 保留 Conv_0、Conv_1 为 FP32，压缩另外 112 个卷积权重。PP-YOLOE 压缩优化图的 84 个卷积权重张量；不量化激活和均值归约，因此不复用之前 FP16 的归约路径。两款模型使用 opset 13。

本次仅本地生成与验证，模型尚无 ModelScope/Hugging Face 公网下载地址；手机、峰值内存和大规模独立评测仍待完成。公开分发前应固定新 revision 和校验值，不覆盖既有 FP32 模型资产。
