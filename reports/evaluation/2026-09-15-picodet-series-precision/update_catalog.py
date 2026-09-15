"""按已发布清单更新 Demo 和中文发布说明；不改 SDK API。"""
from pathlib import Path
import re
import statistics
import quality as q
import publish

def main():
    for name in ('README.md','README.en.md'):
        q.require('## 2026-09-15 PicoDet 精度扩展' not in (q.ROOT/name).read_text(encoding='utf8'), '文档更新已执行，请勿重复运行')
    jobs=q.read(q.REPORT/'published-jobs.json')
    summary=q.read(q.REPORT/'summary.json')
    accepted,summary,lock=publish.selected()
    publish.validate_published_jobs(jobs,accepted)
    publish.validate_lifecycle('lifecycle-published.json',jobs,summary,lock)
    publish.validate_downloads('weights')
    publish.validate_downloads('metadata')
    publish.validate_remote(jobs,summary)
    for evidence in ('weights-downloads.json', 'metadata-downloads.json'):
        rows=q.read(q.REPORT/evidence)
        q.require(rows and all(x['status']=='passed' for x in rows), '发布回读未完成：'+evidence)
    remote=q.read(q.REPORT/'remote-smoke.json')
    q.require(len(remote['rows'])==len(jobs)*2 and all(x['status']=='passed' for x in remote['rows']), '浏览器双源验证未完成')
    keys=sorted({x['key'] for x in jobs})
    for name in ('apps/demo/src/model-sources.ts','scripts/stage-pages-models.mjs'):
        path=q.ROOT/name
        text=path.read_text(encoding='utf8')
        for key in keys:
            old=f'pp-detection/{key}/manifest.json'
            new=f'pp-detection/{key}/1.0.1/manifest.json'
            q.require(old in text or new in text,f'没有找到 Demo 清单路径：{name}/{key}')
            text=text.replace(old,new)
        if name=='scripts/stage-pages-models.mjs':
            # 当前入口升级的同时继续发布旧地址，避免旧客户端遇到404。
            anchor='  "pp-detection/1.0.2/manifest.json",'
            legacy='\n'.join(f'  "pp-detection/{key}/manifest.json",' for key in ('picodet-xs-320','picodet-xs-416','picodet-s-320','picodet-s-416','picodet-m-320','picodet-m-416','picodet-l-416','picodet-l-640'))
            q.require(anchor in text, '没有找到历史清单暂存锚点')
            text=text.replace(anchor,anchor+'\n'+legacy,1)
        path.write_text(text,encoding='utf8',newline='\n')
    candidates=summary['candidates']
    count=sum(x['qualityGatePassed'] for x in candidates)
    total=23+count
    current_note=f'2026-09-15：当前 SDK 共 13 个规格、{total} 个稳定变体。PicoDet 新增 {count} 个达标 FP16/W8A32 精度，版本 1.0.1；L-320 保持 1.0.2。'
    for name in ('docs/zh-CN/models.md','docs/en/models.md'):
        path=q.ROOT/name; content=path.read_text(encoding='utf8')
        content=re.sub(r'^> 2026-09-15.*$', '> '+current_note, content, flags=re.M)
        content=re.sub(r'^(当前清单包含|The manifests provide).*$', current_note+'默认 FP32 和 ModelScope，允许显式选择 Hugging Face；未通过识别门槛的精度保留 labs。', content, flags=re.M)
        for key in q.MODEL_KEYS:
            label='PicoDet-'+key.split('-')[1].upper()+'-'+key.split('-')[2]+' LCNet'
            path_manifest=q.ROOT/'models/pp-detection'/key/('1.0.1/manifest.json' if key in keys else 'manifest.json')
            manifest=q.read(path_manifest)
            variants={v['id']:f'{v["bytes"]/1e6:.2f} MB' for v in manifest['variants']}
            line=f'| {label} | {manifest["model"]["version"]} | {variants.get("fp32","—")} | {variants.get("fp16","—")} | {variants.get("w8a32","—")} |'
            content=re.sub(r'^\| '+re.escape(label)+r'\s*\|.*$',line,content,flags=re.M)
        content=content.replace('23 个变体',f'{total} 个变体').replace('All 23 variants',f'All {total} variants')
        content=content.replace('models/pp-detection/picodet-<size>-<res>/manifest.json','models/pp-detection/picodet-<size>-<res>/1.0.1/manifest.json')
        content+='\n新增 PicoDet 精度的三轮结果与未发布候选见[本轮对比](../../reports/evaluation/2026-09-15-picodet-series-precision/README.md)。已发布模型版本以清单表为准，FP32 权重沿用原固定来源。\n'
        path.write_text(content,encoding='utf8',newline='\n')
    index=q.ROOT/'models/pp-detection/README.md'
    index.write_text('# PicoDet 模型资产\n\n'+current_note+'\n\nPicoDet 共九个输入规格；SDK 另提供 PP-YOLOE+ S/M/L/X。L-320 当前清单为 `1.0.2/manifest.json`，本轮新增规格清单为 `picodet-<size>-<res>/1.0.1/manifest.json`。原 1.0.0 FP32 及历史版本保持不可变。\n\n默认 FP32、ModelScope，可显式选择 Hugging Face。所有来源固定 revision、bytes 与 SHA-256。PicoDet 新精度仅有桌面三轮和主线程/Worker证据，手机证据不扩展。\n\n[完整精度表](../../docs/zh-CN/models.md) · [本轮对比与发布证据](../../reports/evaluation/2026-09-15-picodet-series-precision/README.md)\n',encoding='utf8',newline='\n')
    sdk=q.ROOT/'sdk-manifest.yaml'; content=sdk.read_text(encoding='utf8')
    content=re.sub(r'^  source: .*$',f'  source: PaddleDetection 官方固定源；PicoDet 九个规格与 PP-YOLOE+ S/M/L/X，共 {total} 个稳定精度变体，默认 L-320、FP32、ModelScope。双 Hub 固定不可变 revision。',content,flags=re.M)
    sdk.write_text(content,encoding='utf8',newline='\n')
    text=f'# PicoDet 全系列 FP16 / W8A32 对比与发布\n\n日期：2026-09-15。新增 8 个规格、16 个精度候选已完成三轮桌面 WASM/WebGPU，共 144 组固定 64 图评测。{count} 个候选满足识别门槛，发布到 ModelScope 和 Hugging Face；其余保留 labs 证据。已有 PicoDet L-320 三精度不重做。\n\n'
    text+='默认仍为 PicoDet L-320、FP32、ModelScope；SDK/npm 保持 0.4.0，新增模型清单独立版本为 1.0.1。模型来源只提供 ModelScope 和 Hugging Face，显式选择失败不静默换源。\n\n'
    text+='## 质量门槛\n\n每个候选仅与同规格、同后端、同轮 FP32 对比：AP 下降≤0.5 个百分点；score≥0.5、同类 IoU≥0.5 一对一检测保留率≥95%。每个候选的六组对比全部满足才通过。IoU≥0.99只诊断坐标偏差，不阻塞发布。固定 COCO 子集为64图、716标注，不代表全量COCO成绩。\n\n'
    text+='| 规格 | 精度 | 文件 MB | 体积减少 | 最低 AP 变化（点） | 最低保留率 | 状态 |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n'
    for row in candidates:
        text+=f'| {row["key"]} | {row["precision"].upper()} | {row["bytes"]/1e6:.2f} | {row["sizeReduction"]:.1%} | {row["minimumApDeltaPoints"]:+.3f} | {row["minimumRetention"]:.2%} | {"稳定发布" if row["qualityGatePassed"] else "labs，未发布"} |\n'
    text+='\nFP16保留敏感算子FP32，W8A32仅把权重存储压缩为INT8，激活和卷积仍为FP32。体积减少独立计为优势，不推导内存同比减少或推理普遍加速。\n\n'
    text+='## 本机耗时\n\n每组排除首图，取63张图片推理耗时的中位数，再取三轮中位数。网络下载不计入下表，原始记录另有加载、首图和端到端耗时。\n\n'
    text+='| 规格 | 精度 | WASM 热推理 ms | WebGPU 热推理 ms |\n| --- | --- | ---: | ---: |\n'
    for key in q.MODEL_KEYS:
        for p in q.PRECISIONS:
            values={b:statistics.median(x['warmInferenceMedianMs'] for x in summary['rows'] if x['key']==key and x['precision']==p and x['backend']==b) for b in q.BACKENDS}
            text+=f'| {key} | {p.upper()} | {values["wasm"]:.2f} | {values["webgpu"]:.2f} |\n'
    text+='\nWindows 11 10.0.26200、Intel Core i5-10400F、Chromium 153.0.8010.12、ORT Web 1.27.0、物理NVIDIA Blackwell。WASM单线程，主线程模式，无SDK后端回退。第三轮未并发构建、上传或其他推理。未新增手机、WebNN/NPU或其他浏览器兼容声明；未测峰值内存。\n\n'
    text+='## 证据与复现\n\n`inputs.lock.json`固定模型、清单、SDK、标注、64图摘要和环境；`artifact-index.json`固定288份压缩结果和轮次绑定。复算校验每组3轮的SHA与时间互异且递增，GPU身份一致；任何错后端、错精度、缺图、错SHA或协议参数变化都会失败。\n\n'
    text+='使用已安装 `tools/model-pipeline/evaluation/requirements.txt` 的Python环境运行：\n\n```powershell\npython reports/evaluation/2026-09-15-picodet-series-precision/quality.py\npython -m unittest discover -s reports/evaluation/2026-09-15-picodet-series-precision -p test_quality.py -v\n```\n\n'
    text+='首次归档加 `--archive`，从 `.tmp/picodet-series-precision/round-N` 读取真实结果。归档后复算无需ONNX与原图片。完整运行需同SHA权重、SDK bundle和64图，设置 `PICODET_IMAGE_ROOT` 与 `PLAYWRIGHT_BROWSERS_PATH` 后运行 `node reports/evaluation/2026-09-15-picodet-series-precision/browser.mjs`。\n\n'
    text+='发布权重/元数据完整回读见 `weights-downloads.json` 与 `metadata-downloads.json`，浏览器双源下载、SHA/CORS和推理见 `remote-smoke.json`，最终清单主线程与Worker取消/恢复/释放见 `lifecycle-published.json`。所有证据只对记录日期、环境和文件身份有效。\n'
    (q.REPORT/'README.md').write_text(text,encoding='utf8',newline='\n')
    notice=f'PicoDet XS/S/M/L 九个输入规格已提供 FP32；本轮新增 {count} 个通过桌面三轮验收的 FP16/W8A32 变体。识别未达标候选保留 labs，Demo 仅启用已发布精度。详见[精度对比报告](reports/evaluation/2026-09-15-picodet-series-precision/README.md)。默认 PicoDet-L-320、FP32、ModelScope，SDK/npm 保持 0.4.0。'
    for name in ('README.md','README.en.md'):
        path=q.ROOT/name; content=path.read_text(encoding='utf8')
        content=content.replace('23 个 stable 变体', f'{total} 个 stable 变体').replace('23 个稳定变体', f'{total} 个稳定变体').replace('23 stable variants', f'{total} 个稳定变体')
        content=content.replace('PicoDet 新清单版本为 1.0.0', 'PicoDet 新清单版本为 1.0.1').replace('New PicoDet manifests use version 1.0.0', '新增 PicoDet 清单版本为 1.0.1')
        for key in keys:
            manifest=q.read(q.ROOT/'models/pp-detection'/key/'1.0.1/manifest.json')
            label='PicoDet-'+key.split('-')[1].upper()+' '+key.split('-')[2]
            sizes={v['id']:f'{v["bytes"]/1e6:.2f} MB' for v in manifest['variants']}
            line=f'| {label} | {sizes["fp32"]} | {sizes.get("fp16","—")} | {sizes.get("w8a32","—")} |'
            content=re.sub(r'^\| '+re.escape(label)+r'\s*\|.*$',line,content,flags=re.M)
        marker='## 2026-09-15 PicoDet 精度扩展'
        q.require(marker not in content, '文档更新已执行，请勿重复追加')
        content+='\n'+marker+'\n\n'+notice+'\n'
        path.write_text(content,encoding='utf8',newline='\n')
    path=q.ROOT/'models/README.md'; content=path.read_text(encoding='utf8')
    content=content.replace('23 个稳定变体',f'{total} 个稳定变体')
    content=re.sub(r'^八个新增 PicoDet 仅 FP32.*$', 'PicoDet 新增八个 FP16 与六个 W8A32，XS-320/416 的 W8A32 未满足保留率门槛，继续保留 labs。[本轮对比](../reports/evaluation/2026-09-15-picodet-series-precision/README.md)包含质量、耗时及分发证据。',content,flags=re.M)
    for key in keys:
        manifest=q.read(q.ROOT/'models/pp-detection'/key/'1.0.1/manifest.json')
        label='PicoDet-'+key.split('-')[1].upper()+' '+key.split('-')[2]
        sizes={v['id']:f'{v["bytes"]:,}' for v in manifest['variants']}
        line=f'| {label} | 1.0.1 | {sizes["fp32"]} | {sizes.get("fp16","—")} | {sizes.get("w8a32","—")} | [{label}](pp-detection/{key}/1.0.1/manifest.json) |'
        content=re.sub(r'^\| '+re.escape(label)+r'\s*\|.*$',line,content,flags=re.M)
    path.write_text(content,encoding='utf8',newline='\n')
    path=q.ROOT/'packages/sdk/README.md'; content=path.read_text(encoding='utf8')
    content=content.replace('23 个 stable 变体：八个新增 PicoDet 规格仅 FP32，其余五个规格提供 FP32、FP16、W8A32',f'{total} 个稳定变体：PicoDet XS-320/416 提供 FP32、FP16，其余规格提供 FP32、FP16、W8A32')
    content=content.replace('PicoDet 13 个规格、23 个 stable 变体（新规格清单 1.0.0，L320 为 1.0.2）与 PP-YOLOE+ S/M/L/X 0.1.1',f'PicoDet 与 PP-YOLOE+ S/M/L/X 共 13 个规格、{total} 个稳定变体（PicoDet 新清单 1.0.1，L320 为 1.0.2，PP-YOLOE+ 为 0.1.1）')
    content=re.sub(r'^- `precision: "auto"`.*$', '- `precision: "auto"` 选择清单默认 FP32；`precision: "fp16"` 选择 FP16，`precision: "int8"` 选择 W8A32。PicoDet XS-320/416 尚未发布 W8A32，显式请求未声明精度返回 `CAPABILITY_UNSUPPORTED`。',content,flags=re.M)
    content+='\nPicoDet 本轮新增 14 个通过三轮桌面识别门槛的精度；[质量与分发证据](https://github.com/chenmohan123/web-sdk-PP-Detection/tree/main/reports/evaluation/2026-09-15-picodet-series-precision)。SDK API 和 npm 版本保持 0.4.0。\n'
    path.write_text(content,encoding='utf8',newline='\n')
    path=q.ROOT/'CHANGELOG.md'; content=path.read_text(encoding='utf8')
    title,rest=content.split('\n',1)
    content=title+f'\n\n## 2026-09-15 — PicoDet 精度模型与 Demo 更新\n\n- 新增 {count} 个通过三轮 WASM/WebGPU 识别门槛的精度变体，未通过者保留 labs。\n- 新版本清单为 1.0.1，默认模型、FP32、ModelScope 不变；运行时与 npm 维持 0.4.0。\n- 比较与发布证据见 `reports/evaluation/2026-09-15-picodet-series-precision/`。\n'+rest
    path.write_text(content,encoding='utf8',newline='\n')
    print(f'Demo与文档已同步{count}个新增稳定变体。')

if __name__=='__main__': main()
