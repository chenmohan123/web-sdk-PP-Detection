# 六变体示例

本目录是可独立复制的 Vanilla Vite 消费者，固定使用公开 npm 包 `web-sdk-pp-detection@0.3.1`。页面可选择 PicoDet-L-320 1.0.2 或 PP-YOLOE+ S 640 0.1.1、ModelScope 或 Hugging Face，以及 FP32、FP16 或 W8A32。默认组合为 PicoDet、ModelScope、FP32。

```powershell
pnpm install
pnpm dev
pnpm build
```

打开终端输出的本地地址，选择图片后运行检测。模型清单分别固定到以下不可变 revision，不使用 `master` 或 `latest`：

- ModelScope：`88d23d254e9cc2c98874ae8bd8a7c092612e65f6`
- Hugging Face：`16e7920650777479820b9301dec90a59b0d5833c`

界面中的 W8A32 通过 SDK 参数 `precision: "int8"` 选择；它表示权重以 INT8 存储、激活与卷积计算保持 FP32。显式来源失败时页面显示错误，不会切换到另一个 Hub。取消、页面离开和检测结束都会等待释放检测器；已校验模型仍可保留在浏览器缓存中。

六个变体均为已发布稳定清单能力，并兼容 npm `0.3.1`。本示例保留已验证的 0.3.1 固定依赖以演示基础 API；如需下载超时和有限重试，请将依赖升级至 0.3.2，配置方法见[API](../../docs/zh-CN/api.md)。

FP16 与 W8A32 的当前证据仅覆盖 2026-09-12 桌面 WASM/WebGPU 固定 64 图三轮验证；小米 15 实测仅覆盖原 FP32，不能据此扩大移动设备兼容承诺。
