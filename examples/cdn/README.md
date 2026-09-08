# 静态浏览器示例

本目录可原样复制，无需构建。SDK 脚本固定为公开版本 `web-sdk-pp-detection@0.2.0`，默认从 ModelScope 加载官方 PicoDet-L-320 v1.0.1 清单。

```powershell
pnpm dlx http-server@14.1.1 . -p 8080 -c-1
```

打开 <http://127.0.0.1:8080>，选择图片并点击“检测”。部署时使用 HTTPS（本地 localhost 可用于调试）。首次使用需要访问 jsDelivr 与 ModelScope；无需替换 URL 或模型文件。

模型清单：<https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/master/manifest.json?v=1.0.1>。固定 `source: "modelscope"`，不会静默换源。图片只在浏览器处理。

“取消”中止当前操作；检测完成、取消或页面离开后统一释放会话。重复点击不会同时初始化多个实例。页面进入后台触发 pagehide 后会取消，返回时可重新检测。缓存保留已校验模型；正式应用可使用 SDK 缓存 API 提供清理入口。
