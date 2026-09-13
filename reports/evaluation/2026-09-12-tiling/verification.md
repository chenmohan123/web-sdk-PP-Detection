# 验收与局限

2026-09-12 完成。本轮为单 SDK 的本地评估资料变更，没有接入 runtime 或 Demo。

## 已执行检查

| 验收项                                                                                                                                      | 实际结果                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 六个正式资产及 64 图校验                                                                                                                    | 全部字节数 / SHA256 匹配输入锁                                                             |
| `node …/check-geometry.mjs`                                                                                                                 | 尺寸全覆盖、RGBA 行复制、局部框裁剪偏移、同类去重、异类重叠保留通过                        |
| `python …/summarize.py --check`                                                                                                             | 一对一、同类重复、异类误检、crowd 忽略及空预测通过                                         |
| 2 图 FP32 WebGPU 预检                                                                                                                       | PicoDet 通过，单独保存，未混入正式统计                                                     |
| 六模型 × 两后端完整矩阵                                                                                                                     | 12/12 通过；每个 64 图，0 pageerror，无 SDK 后端回退                                       |
| `python …/summarize.py`                                                                                                                     | 官方 COCOeval 36 行结果完成，模型/精度/后端/版本/图片序列一致，TP＋FN 均为 700             |
| `python …/figures.py`                                                                                                                       | 总览图、完整对照表及 6 个案例生成；人工查看总览与收益、损失、误检案例                      |
| `python …/verify-evidence.py`                                                                                                               | 原始文件及执行脚本哈希、协议、bundle、耗时分解、案例来源、前后规范检查与产品未改动复核通过 |
| `pnpm evaluation:test`                                                                                                                      | 5/5 通过                                                                                   |
| `python -m pytest tools/model-pipeline/tests/test_detection_evaluation.py -p no:cacheprovider --basetemp=.tmp/tiling-pytest-check-final -q` | 21/21 通过                                                                                 |
| `pnpm test`（SDK）                                                                                                                          | 20 文件、193 测试通过                                                                      |
| `pnpm build`（SDK）                                                                                                                         | ESM、IIFE、Worker 与类型声明构建通过；bundle 与评估时 SHA256 相同                          |
| `pnpm check`（门户）                                                                                                                        | 0 errors、0 warnings、6 个既有 hints                                                       |
| `pnpm test`（门户）                                                                                                                         | 6 文件、50 测试通过                                                                        |
| 门户 Astro build                                                                                                                            | 临时输出目录构建通过，9 页                                                                 |
| 门户原有 Playwright 测试                                                                                                                    | 5/5 通过，包含 Detection 六变体与窄屏布局                                                  |
| 规范检查前后                                                                                                                                | 均为 required 18 pass、0 fail、4 skip                                                      |

Python 命令使用 `.tmp/phase2/venv/Scripts/python.exe`，`…` 指本报告 `reproduction` 目录。Python 3.11.15、numpy 1.26.4、Pillow 11.3.0、pycocotools 2.0.11。浏览器为 Chromium 153.0.8010.12。

## 环境问题及处理

SDK 根目录历史 `.tmp` 内容存在不可读目录，因此前后规范扫描使用门户下 `.worktrees/detection-release-0.3.2`。它的提交树与正式 SDK 基线一致，均为 `9758aca91ac012eb9276956bd5f4d9bdf5dd66b1`；该检出唯一工作区差异是 PicoDet 的 Git LFS 指针已恢复为模型本体，实际 SHA256 为正式 `0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1`。本轮新增实验目录与格式保留规则不改变被审 SDK/Demo/清单。扫描命令从门户执行：

```powershell
pnpm sdk:check -- --repo .worktrees/detection-release-0.3.2 --format json --out ../web-sdk-PP-Detection/reports/evaluation/2026-09-12-tiling/standard-after.json
```

4 项远程规则未扫描，因此只称本地合规。本轮没有执行远程 GitHub 写操作。

门户常规构建最初因沙箱无法写入/清理现有 `dist` 失败。最终在已授权本地执行环境使用 `node_modules/.bin/astro.cmd build --outDir .tmp/detection-tiling-portal-dist` 成功，未更改门户源码。

门户 Playwright 使用的浏览器修订号 1234 与 SDK 已安装修订号 1243 不同；首次测试未进入页面，失败原因为浏览器文件缺失。最终通过临时配置 `.tmp/tiling-portal-playwright.config.ts` 明确指定已存在的 `chromium-1243/chrome-win64/chrome.exe`，原有全部 5 项测试通过。此配置仅在门户临时目录，不修改正式测试配置。

首次 Python 测试命令误指向只有实现文件的 `evaluation` 目录，没有收集到测试，并发现历史 pytest 缓存目录不可写。最终改为已定位的 `tests/test_detection_evaluation.py` 并关闭缓存提供器，21 项通过；不把首次空运行计入通过数量。

## 复核结论

实验实现只复用 SDK 的公开 `ImageRaster`、`createPPDetection()`、`detect()` 和 `dispose()`。浏览器服务器仅绑定回环地址并使用明确的文件路由表；模型和图片不上传。实验脚本、预先固定协议保留执行时字节，避免格式整理破坏运行脚本的哈希关联。

性能测试期间组合串行；汇总、测试与构建在矩阵结束后执行。原始数据保存了所有模式、所有切片、预热和错误/警告；没有删去慢图、只选收益图或在看到结果后调整切片参数。模型身份、实际后端及无回退证据均来自正式 SDK。

本地原始 JSON 压缩文件与照片叠框图不进入 Git，文件清单和哈希保存在 `evidence-index.json`。公共模型资产、COCO 图片原许可保持原来源，未把样本或模型改为 SDK 许可证。

证据只能支持 64 张最长边不超过 640 的图片及本机浏览器环境。没有独立高分辨率确认集、手机切片实测、峰值内存、长时视频或跨浏览器验证。结论是继续优化合并策略的实验价值，不是稳定功能发布或兼容性承诺。
