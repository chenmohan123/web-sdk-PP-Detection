# vue 示例

本目录可原样复制到仓库外。使用公开 npm 包 `web-sdk-pp-detection@0.1.1`，默认加载 ModelScope 的官方 PicoDet-L-320 v1.0.1 清单。首次运行需要访问模型仓库和 ONNX Runtime CDN。

```powershell
pnpm install
pnpm dev
pnpm build
```

打开终端打印的本地地址，选择图片后点击“检测”。“取消”会中止下载/推理请求并等待释放；连续点击不会并发初始化，页面或组件卸载后迟到的实例也会释放。每次检测结束后释放会话，已校验模型保留在浏览器缓存中。

模型清单：<https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/master/manifest.json?v=1.0.1>。示例固定选择 `source: "modelscope"`，失败时显示错误码，不自动换源。图片只在当前浏览器处理，不上传。

浏览器需支持 WebAssembly；可用时自动选择 WebGPU。当前示例使用主线程执行，宿主负责其页面生命周期。

`backend: "auto"` 显式配合 `allowFallback: true`：GPU 适配器不可用时允许转用 WASM，实际后端与回退记录保留在结果中。来源仍固定 ModelScope。
