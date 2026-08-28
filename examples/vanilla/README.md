# Vanilla DOM 示例

这是不依赖 React/Vue 的浏览器 DOM 示例，适合 H5、公众号 WebView 和其他轻量页面。示例从 npm CDN 加载 SDK，调用方需要把 `manifestUrl` 替换为自己的已验证 runtime manifest 地址。

直接用静态服务器打开 `index.html`，或将文件复制到现有 H5 工程中。页面会展示模型加载进度、实际后端、精度、模型大小、参数量和本次推理耗时。

原生微信小程序不能直接执行该示例；请使用 `web-view` 承载 H5 页面。
