# PP-YOLOE+ S 稳定模型与候选复现

当前仓库的 PP-YOLOE+ S 640 FP32 清单为 **0.1.0 stable**，默认加载无需实验许可。模型本体从固定 Hub 地址下载，npm 包不包含权重。已验证的设备与状态变更见[稳定记录](../../reports/stability/2026-09-12-ppyoloe/README.md)。

## 直接使用 Demo

[在线 Demo](https://chenmohan123.github.io/web-sdk-PP-Detection/) 提供 PicoDet 与 PP-YOLOE 两个稳定模型；默认使用 PicoDet。两者随构建携带清单，PP-YOLOE 模型字节与先前评测候选一致。

```powershell
pnpm --filter web-sdk-pp-detection build
pnpm --filter @ppdetection/demo dev --host 127.0.0.1
```

打开 `http://localhost:4174/`，选择“PP-YOLOE+ S 640”，在模型来源中选择 Hugging Face 或 ModelScope，然后选取示例图片开始检测。移动端操作见[小米 15 清单](../../reports/distribution/2026-09-11-ppyoloe/mobile-validation.md)。

自行集成时安装 `web-sdk-pp-detection@0.3.0`，并使用本仓库 v0.3.0 标签下的 `models/ppyoloe-plus-s-640/manifest.json`：

```ts
import { createPPDetection, parseDetectionManifest } from "web-sdk-pp-detection";
import manifestJson from "../../models/ppyoloe-plus-s-640/manifest.json";

const detector = await createPPDetection({
  model: parseDetectionManifest(manifestJson),
  source: "modelscope",
  backend: "wasm",
  allowFallback: false,
  ort: { wasm: { paths: "/ort/" } }
});
```

`/ort/` 需提供与 SDK 依赖版本一致的 ORT Web 资源；Demo 已配置该路径。检测结束后调用 `detector.dispose()`。指定来源不可用时会报错，也可显式将 `source` 改为 `"huggingface"`。

Hub 已有的 `0.1.0-labs.1/manifest.json` 是实验版快照，稳定版接入使用当前仓库的清单。固定模型 URL 的目录仍可包含 `labs`，来源字节由 revision、大小和 SHA-256 校验。

## 重新导出实验候选

先按[模型复现指南](../../tools/model-pipeline/ppyoloe/README.md)准备 Python 环境、下载来源和固定数据，再安装仓库依赖并构建 SDK：

```powershell
pnpm install --frozen-lockfile
pnpm --filter web-sdk-pp-detection build
```

导出所用 PaddleDetection 源码必须固定为提交
`b25522a0f4bde8c80603f3ba5e3472059972e3b5`。以下命令假设源码目录名为
`PaddleDetection-b25522a0f4bde8c80603f3ba5e3472059972e3b5`，权重和 COCO
子集已经按评测锁文件准备到 `.tmp/phase2/`：

```powershell
$env:PYTHONPATH = "tools/model-pipeline"

python -m ppyoloe.export `
  --upstream .tmp/phase2/upstream/PaddleDetection-b25522a0f4bde8c80603f3ba5e3472059972e3b5 `
  --weights .tmp/phase2/downloads/ppyoloe-plus-s.pdparams `
  --output-dir .tmp/phase2/exported `
  --temp-dir .tmp/phase2/export-temp `
  --onnx-output .tmp/phase2/ppyoloe-plus-s-fp32.onnx

python -m ppyoloe.fix_onnx `
  --input .tmp/phase2/ppyoloe-plus-s-fp32.onnx `
  --output .tmp/phase2/ppyoloe-plus-s-candidate.onnx `
  --report .tmp/phase2/ppyoloe-fix.json

python -m ppyoloe.build_manifest `
  --model .tmp/phase2/ppyoloe-plus-s-candidate.onnx `
  --annotations .tmp/phase2/dataset/annotations.json `
  --output .tmp/phase2/ppyoloe-runtime-manifest.json
```

## 最小调用

重新导出的 labs 候选必须显式传入 `allowExperimental: true`。默认值是 `false`，`blocked` 变体
即使显式允许实验能力也不会被选择。

```ts
import { createPPDetection } from "../../packages/sdk/dist/index.js";

const [manifest, modelResponse] = await Promise.all([
  fetch("/ppyoloe-runtime-manifest.json").then((response) => response.json()),
  fetch("/ppyoloe-plus-s-candidate.onnx")
]);

const detector = await createPPDetection({
  allowExperimental: true,
  allowFallback: false,
  backend: "wasm",
  cache: false,
  executionMode: "main",
  model: { data: await modelResponse.arrayBuffer(), manifest },
  ort: { wasm: { numThreads: 1, paths: "/ort/" } },
  precision: "fp32"
});

try {
  const result = await detector.detect(imageBlob, { threshold: 0.001 });
  console.log(result.detections, result.runtime, result.timings);
} finally {
  await detector.dispose();
}
```

## 浏览器评测

正式 runner 使用 SDK 的 `createPPDetection()` 和 `detect()` 公共 API，禁用回退和
缓存，固定主线程模式与单 WASM 线程。它会记录模型、清单、标注及每张图片的
SHA-256，Session、首张、后续 63 张 median/p90、逐图耗时、COCO predictions、
实际后端和浏览器/CPU/GPU 环境。PP-YOLOE 清单声明的 bicubic 对应 SDK 的
Pillow bicubic 语义。

先运行 WASM，再单独运行 WebGPU，避免并发计时：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = ".tmp/dependencies-compatible-browsers"

pnpm evaluation:browser -- `
  --model .tmp/phase2/ppyoloe-plus-s-candidate.onnx `
  --manifest .tmp/phase2/ppyoloe-runtime-manifest.json `
  --annotations .tmp/phase2/dataset/annotations.json `
  --image-root .tmp/phase2/dataset/images `
  --backend wasm `
  --output .tmp/phase2/results/browser-ppyoloe-wasm-formal.json

pnpm evaluation:browser -- `
  --model .tmp/phase2/ppyoloe-plus-s-candidate.onnx `
  --manifest .tmp/phase2/ppyoloe-runtime-manifest.json `
  --annotations .tmp/phase2/dataset/annotations.json `
  --image-root .tmp/phase2/dataset/images `
  --backend webgpu `
  --output .tmp/phase2/results/browser-ppyoloe-webgpu-formal.json
```

WebGPU 只有在适配器具有可识别的硬件身份、未标记回退且不是已知软件适配器时
才运行；Chromium 隐去的字段仍按 `null` 原样记录。其他情况写入 `unsupported`
证据并以非零码退出。运行失败同样写入错误、环境和请求配置，且以非零码退出。
runner 不执行 COCOeval；质量与一致性评测继续交给
`tools/model-pipeline/evaluation` 中的 Python 工具。
