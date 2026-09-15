# Tiny FP32 发布管道

`publish.py` 只处理本批模型发布，默认不自动执行远程操作。使用宿主机现有 Python 与 Hub 登录缓存，不读取或显示 token，不安装依赖。

执行顺序（从 SDK 仓库根目录）：

```powershell
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py prepare
python -m pytest reports/distribution/2026-09-15-ppyolo-tiny/test_publish.py -q -p no:cacheprovider
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py weights
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py verify-weights
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py manifests
node reports/distribution/2026-09-15-ppyolo-tiny/browser.mjs
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py metadata
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py verify-metadata
python reports/distribution/2026-09-15-ppyolo-tiny/publish.py validate
```

每一步退出码非零必须停止。`weights` 和 `metadata` 才执行双源写入；其余为本地准备、真实GET回读或验证。已有上传状态后不允许重新prepare覆盖协议；阶段断点复用必须匹配来源、真实40位revision、协议/收据以及完整文件集合。发生未经记录的部分远端上传时，先检查远端实际情况，不能绕过不可覆盖检查。

prepare调用固定phase2 Python复算原始质量归档及Paddle可训练参数，核对64张真实图片、固定上游源码与许可，冻结相关证据摘要。权重阶段仅包含新版本目录中的ONNX、README、LICENSE、conversion.json。完整GET通过后才能从原始candidate复制runtime契约、生成单一FP32变体和两源清单。清单不会由测试写入真实产品目录。

元数据上传要求最终清单和真实浏览器八组合通过；允许上传的文件仅为根README和本批版本的manifest/README/LICENSE/conversion.json，不删除其他版本。覆盖根README前校验固定前值；Hugging Face使用parent_commit进行原子前值检查，ModelScope接口不支持parent_commit，脚本在写入前再次核对HEAD与固定内容，随后固定revision完整回读。ModelScope的检查和提交之间仍存在服务端不提供原子CAS的时间窗口，不应并行操作该仓库。

浏览器脚本独立维护；真实结果包含来源、后端、main/Worker、取消恢复、重复释放、缓存命中、缓存清理、来源模型摘要与执行模式。validate复核这些字段及协议、收据、SDK、Worker和最终manifest摘要。本批只声明已记录桌面环境，不增加手机或NPU兼容性。
