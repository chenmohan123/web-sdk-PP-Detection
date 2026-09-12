# 两款模型的 FP16 与 W8A32 分发

日期：2026-09-12。按用户“体积减少也算优势，只要识别正常即可上线”的要求，发布 PicoDet 1.0.2、PP-YOLOE 0.1.1 稳定清单。新增FP16/W8A32各两款，FP32复用已有不可变资产，默认FP32、默认来源ModelScope，另提供Hugging Face。

| 来源        | 模型提交                                   | 清单提交                                   |
| ----------- | ------------------------------------------ | ------------------------------------------ |
| modelscope  | `4ec78fa50dcac4ecf02d0ae6b2f7bd1e0b26e538` | `88d23d254e9cc2c98874ae8bd8a7c092612e65f6` |
| huggingface | `768d6bdf1b9cb906a6b640516b835d39cc6c375e` | `16e7920650777479820b9301dec90a59b0d5833c` |

两个Hub仓库均为 `chenmohan/web-sdk-pp-detection`，新目录为 `picodet-l-320/1.0.2` 和 `ppyoloe-plus-s-640/0.1.1`。发布载荷包括4个ONNX、2份模型卡、2份Apache许可证、4份转换记录以及2份三精度清单。上传前后全部旧文件身份一致，无删除或覆盖。

两Hub共28个文件的公开固定URL回下载已核验。ONNX权重逐字节哈希与本地评测产物一致；ModelScope清单响应将CRLF规范为LF，结构与值完全相同，回下载报告同时保存响应SHA-256及仅换行差异标记。不能把上传字节摘要当作该HTTP响应摘要。

完整质量和速度对比见[三精度评测](../../evaluation/2026-09-12-precision-variants/README.md)。FP16/W8A32的36组识别运行通过；手机、其他浏览器与峰值内存不属于该证据范围。SDK API与npm版本仍为0.3.1，本轮模型和Demo可独立升级。

Demo随构建携带新版本稳定清单，W8A32用SDK `precision: int8` 加载，实际显示依据量化声明和变体ID。不同模型/版本/变体/来源哈希隔离缓存。显式来源失败不切换来源，显式后端不回退。生产预览与线上验收记录随发布附后。

## 发布前验证

生产预览从公开 Hub 实际下载并推理，ModelScope 两模型三精度各覆盖 WASM/WebGPU 共12项，Hugging Face 两模型 FP16/W8A32 在 WASM 上共4项，合计16项全部通过。每项核对模型版本、变体、来源、SHA-256、实际后端、精度、无回退和非空检测，并保留导出JSON。一次ModelScope下载超过180秒，重试后成功，原始失败记录仍保留于 demo-local/，不计作成功。

仓库发布检查全部通过：146项SDK测试，77项Demo测试（76项首次通过，修正一项旧版本路径期望后单独复测通过），36项Python测试，以及格式、文档、示例、发布契约、基准一致性、lint、类型与构建。原始 pnpm verify 的格式遍历受本机旧临时目录权限影响，改用 Git 跟踪及未忽略文件列表完成同等格式检查，其他发布步骤逐项执行通过；CI将从干净检出运行完整命令。详见 workspace-checks.json、standard-after.json 和 demo-local-verification.json。
