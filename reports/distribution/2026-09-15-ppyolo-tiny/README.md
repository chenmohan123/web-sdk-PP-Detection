# PP-YOLO Tiny 320 FP32 发布与验证

2026-09-15：Tiny 320 FP32 模型 **0.1.0** 已完成双Hub权重、元数据发布和完整回读；SDK/npm沿用 **0.4.0**。本记录中的本地Demo验证通过，正式Demo部署在PR合并后单独复核。

- 权重4,511,117字节，SHA-256 `1065a342456dfddf91d3220d2ec929640fa253d17562804cae5dbe7772c22653`，opset14、可训练参数1,086,147。固定[模型清单](../../../models/ppyolo-tiny-320/0.1.0/manifest.json)与[上轮64图质量报告](../../evaluation/2026-09-15-2d-candidates/README.md)对应同一模型和SDK摘要。
- ModelScope权重提交 `9ca30805615e4e00e5a643aa89b5aaaaedfa2ad2`，元数据提交 `b02d9d3c5752e9b1aac8fded7b69a8d6bca7a3e3`。
- Hugging Face权重提交 `0a9a95db338aa4e99264205c4f703fbd949af999`，元数据提交 `fc1a48993e70838e368c2438774da1cb7c1ee168`。
- 双源每份ONNX、模型卡、Apache许可、转换说明和清单都完整GET回读，见[权重记录](weights-downloads.json)、[元数据记录](metadata-downloads.json)。根模型卡前值核对通过，未删除其他版本。
- [浏览器原始结果](browser.json)：双源×WASM/WebGPU×main/Worker，共8组通过；每组真实下载与SHA校验、12个目标、预取消与恢复、重复释放、缓存命中及两种清理通过；同后端不同来源和执行模式结果一致。
- [本地Demo结果](demo-local/verification.json)：双源×CPU/GPU共4组真实检测通过，14个模型选项，默认PicoDet-L-320/ModelScope，Tiny仅FP32，导出JSON身份正确，390px无页面溢出。另有86项Demo行为测试通过。
- [本地完整检查](local-checks.json)含206项SDK单测、33项发布器测试、文档/示例/发布/基准契约、lint、typecheck、构建、Pages清单复制与格式检查。[前置标准检查](standard-before.json)、[后置标准检查](standard-after.json)均无required失败；[只读GitHub治理证据](governance.json)保留仓库保护与Pages配置。

桌面环境为Windows 11 10.0.26200、i5-10400F、物理NVIDIA Blackwell、Chromium153.0.8010.12、ORT Web1.27.0。本次不增加手机或NPU兼容声明，也不把预取消验证扩大为进行中取消竞态覆盖。第一次分发浏览器运行与会重建SDK dist的检查并行，Worker文件短暂缺失而中断；检查结束后串行重跑8组全部通过，模型与runtime未变。

## 复现与发布工具

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
