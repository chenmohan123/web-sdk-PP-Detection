# PP-YOLOE 实验模型分发与 Demo 验证

> 后续状态：2026-09-12 用户确认 PP-YOLOE 转为 0.1.0 stable，见[稳定记录](../../stability/2026-09-12-ppyoloe/README.md)。本文记录此前 labs 分发与验证；当时本地 manifest 和模型卡的原始字节已保存到[历史快照](../../stability/2026-09-12-ppyoloe/previous/)。

本轮将上一阶段的 PP-YOLOE+ S 640 FP32 候选分发为 `0.1.0-labs.1`，并为开发版 Demo 增加模型选择。PicoDet 继续默认；候选保持 labs。

## 固定来源

| 来源         | 模型提交                                   | 清单提交                                   | 清单范围                                      |
| ------------ | ------------------------------------------ | ------------------------------------------ | --------------------------------------------- |
| Hugging Face | `45a646ce13dcf2e2c05231954b1e32b9c412720b` | `dd05670d8e54c187112cc77051cd742cdbba7e24` | 初始分发快照，仅 Hugging Face                 |
| ModelScope   | `af865f1c515634de08fe0fc5eeeac8942456241c` | `9f3f052a30bb8560aaabe204a84d5e51cf989079` | 当前双来源清单，含 Hugging Face 与 ModelScope |

两个 Hub 的仓库均为 `chenmohan/web-sdk-pp-detection`，版本目录为 `ppyoloe-plus-s-640/0.1.0-labs.1`。模型均为 31,954,220 bytes，SHA-256 均为 `d3ae6a9f75311e7a05b535c4c0d4a1cdaad6342f87a0339cef5b4e52b106749c`；固定地址回下载均为 HTTP 200，字节数与哈希相符。

当前[双来源固定清单](https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/9f3f052a30bb8560aaabe204a84d5e51cf989079/ppyoloe-plus-s-640/0.1.0-labs.1/manifest.json)与本地 [`models/ppyoloe-plus-s-640/manifest.json`](../../../models/ppyoloe-plus-s-640/manifest.json)字节一致。2026-09-11 的 [Hugging Face 初始清单](https://huggingface.co/chenmohan/web-sdk-pp-detection/resolve/dd05670d8e54c187112cc77051cd742cdbba7e24/ppyoloe-plus-s-640/0.1.0-labs.1/manifest.json)保留为单来源历史快照。

分发在独立版本目录内完成。Hugging Face 上传和回下载证据见 [upload-inventory.json](upload-inventory.json)、[hub-verification.json](hub-verification.json)。ModelScope 补充分发跨越北京时间 2026-09-11 至 09-12，证据见[模型上传记录](modelscope-model-upload.json)、[清单上传记录](modelscope-manifest-upload.json)和[回下载验证](modelscope-verification.json)；两次上传前后原有文件身份一致。来源、上游许可与评测范围见 [source-evidence.json](source-evidence.json)，许可与模型卡在模型目录中。

## Demo 使用

```powershell
pnpm --filter web-sdk-pp-detection build
pnpm --filter @ppdetection/demo dev --host 127.0.0.1
```

打开 `http://localhost:4174/`。选择检测模型后，来源列表按该模型可用清单更新；PP-YOLOE 显示实验状态和验证限制，可显式选择 Hugging Face 或 ModelScope。选择图片并运行后可查看实际后端、版本、SHA-256、加载与推理耗时。

两份官方模型清单随 Demo 构建携带，模型文件从清单绑定的提交下载。显式来源失败会报错；切换模型会取消旧任务、释放实例、撤下旧结果并按 id/version 切换缓存身份。调用实验模型需使用本地 SDK 构建的 `allowExperimental: true`；已发布 npm 0.2.0 不含本轮新选项。

## 验证入口与边界

桌面验收脚本为 [verify-demo.mjs](verify-demo.mjs)，使用真实 Demo、公开模型 URL 和实际 SDK，不拦截网络或注入检测输出。需先启动 Demo，再执行：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = ".tmp/dependencies-compatible-browsers"
$env:PPDETECTION_DEMO_SOURCE = "modelscope"
$env:PPDETECTION_DEMO_BACKENDS = "wasm"
$env:PPDETECTION_REPORT_DIRECTORY = "reports/distribution/2026-09-11-ppyoloe/modelscope-browser-wasm"
node reports/distribution/2026-09-11-ppyoloe/verify-demo.mjs
$env:PPDETECTION_DEMO_BACKENDS = "webgpu"
$env:PPDETECTION_REPORT_DIRECTORY = "reports/distribution/2026-09-11-ppyoloe/modelscope-browser-webgpu"
node reports/distribution/2026-09-11-ppyoloe/verify-demo.mjs
```

脚本记录当前源码与清单哈希、浏览器环境、下载的检测 JSON、页面加载耗时、桌面截图与 390px 布局；失败同样写入报告。默认同时执行两个后端，也可通过 `PPDETECTION_DEMO_BACKENDS` 单独执行。使用生产预览时，将 `PPDETECTION_DEMO_URL` 设为 `http://127.0.0.1:4176/web-sdk-PP-Detection/`。

2026-09-12 的 ModelScope 验收分两个浏览器会话完成：[WASM 3 次通过](modelscope-browser-wasm/desktop-browser.json)、[WebGPU 2 次通过](modelscope-browser-webgpu/desktop-browser.json)。PicoDet / PP-YOLOE 各完成 WASM 与物理 NVIDIA WebGPU 推理，PP-YOLOE 另完成持久缓存复用。实际来源和后端与请求一致、没有 fallback、没有未处理页面异常。两次早期连续验收在重复冷下载 PicoDet 时超时，诊断页面停在下载 37%；失败记录保留，详见 [verification.md](verification.md)。

2026-09-11 的 [Hugging Face 5 次通过记录](desktop-browser.json)对应当时的单来源清单。上述验收均使用带 `/web-sdk-PP-Detection/` 路径的生产构建。

Demo 67 项测试、SDK 136 项测试、类型检查、lint、生产构建与文档检查通过。390px 的 `scrollWidth` 与 `clientWidth` 均为 390。完整命令、跳过项和环境限制见 [verification.md](verification.md)。治理结果为 `locally-compliant`，required 失败 0，4 项远程规则未核验。

上述全量测试属于 2026-09-11 的实现阶段；补充 ModelScope 后重新通过来源专项 26 项、模型选择 6 项、文档 5 项、Demo 类型检查与生产构建。最终文件与上传记录的摘要核对见 [modelscope-final-checks.json](modelscope-final-checks.json)，治理复查见 [modelscope-standard-after.json](modelscope-standard-after.json)。

2026-09-12 用户已在小米 15 通过局域网 HTTPS 完成基础功能测试，反馈 CPU/GPU 正常；[实测截图与记录](mobile-xiaomi15-2026-09-12/README.md)确认 Android Edge 上的摄像头检测、实际 WebGPU/FP32 和本轮 ModelScope 模型。完整 [手动验证清单](mobile-validation.md)尚未完成，PP-YOLOE 保持 labs。390px 桌面视口只证明布局，不能替代其他设备或微信 WebView 验证。

本轮只分发了模型 Hub 资产；SDK npm 包、GitHub 分支和 Pages Demo 尚未发布本轮改动。
