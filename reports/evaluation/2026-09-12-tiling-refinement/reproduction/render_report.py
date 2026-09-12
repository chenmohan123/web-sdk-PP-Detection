"""由冻结诊断与独立集实际结果生成中文表格、统计图和案例。"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,gzip
OUT=Path(__file__).resolve().parents[1];(OUT/'figures').mkdir(exist_ok=True)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def font(size):return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',size)
def text(draw,xy,value,size=22,color='#24324a'):draw.text(xy,str(value),font=font(size),fill=color)
NAMES={'picodet':'PicoDet L 320','ppyoloe':'PP-YOLOE+ S 640'}
MODES={'whole':'整图','combined':'原始组合','refined':'改进组合','whole-first':'全部整图优先','edge-contained':'边缘/包含过滤','small-additions':'小框补充','confident-anchor':'可靠整图保护'}
selection=read(OUT/'selection.json');summary=read(OUT/'holdout-summary.json');lock=read(OUT/'holdout-lock.json')
def table(rows,holdout=False):
    lines=['| 模型 | 精度/后端 | 模式 | AP | 小 AP | 大 AP | 小目标 TP | 全部 TP | FP | 中位耗时 ms | P90 ms |','|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        m=r['metrics'];o=r['operating'];t=r.get('timeMs');variant=f'{r.get("variant","fp32").upper()}/{r.get("backend","webgpu")}'
        timing=f'{t["median"]:.1f} | {t["p90"]:.1f}' if t else '— | —'
        lines.append(f'| {NAMES[r["name"]]} | {variant} | {MODES[r["mode"]]} | {m["AP"]*100:.2f} | {m["APSmall"]*100:.2f} | {m["APLarge"]*100:.2f} | {o["smallTp"]} | {o["tp"]} | {o["fp"]} | {timing} |')
    return lines
lines=['# 完整对照','', 'AP 为百分数，固定阈值命中为 score ≥ 0.5、IoU ≥ 0.5。开发集与独立集的类别和分布不同，不能横向比较两组 AP。','', '## COCO 开发集：64 图、399 个小目标','']+table(selection['rows'])+['','## VisDrone 独立集：32 图、1545 个小目标','']+table(summary['rows'])
(OUT/'comparison.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

canvas=Image.new('RGB',(1760,1180),'#f7f9fc');d=ImageDraw.Draw(canvas)
text(d,(55,25),'高分辨率独立验证：整图、原始组合、改进组合',36)
text(d,(55,84),'32 张 VisDrone 图片 · 1360–1920 像素宽 · FP32 / 桌面 WebGPU · 六类映射',23)
colors={'whole':'#64748b','combined':'#d97706','refined':'#0891b2'}
rows=[r for r in summary['rows'] if r['variant']=='fp32' and r['backend']=='webgpu']
specs=[('整体 AP（%）',lambda r:r['metrics']['AP']*100,'{:.1f}'),('小目标命中（/1545）',lambda r:r['operating']['smallTp'],'{:.0f}'),('误检框（FP）',lambda r:r['operating']['fp'],'{:.0f}'),('中位耗时（ms）',lambda r:r['timeMs']['median'],'{:.0f}')]
for col,(title,value,fmt) in enumerate(specs):
    x=55+col*425;text(d,(x,165),title,25);limit=max(value(r) for r in rows)*1.1 or 1
    for group,name in enumerate(NAMES):
        y=245+group*365;text(d,(x,y),NAMES[name],24)
        for pos,mode in enumerate(colors):
            r=next(r for r in rows if r['name']==name and r['mode']==mode);v=value(r);by=y+74+pos*85
            text(d,(x,by-28),MODES[mode],19,colors[mode]);d.rounded_rectangle((x,by,x+max(1,285*v/limit),by+25),radius=6,fill=colors[mode]);text(d,(x+295,by-5),fmt.format(v),22)
text(d,(55,1025),'同一批原始图片与标注；score ≥ 0.5、IoU ≥ 0.5；AP 使用官方 COCOeval 六类适配口径。',22)
text(d,(55,1070),'策略在独立集推理前冻结。耗时复用同一组五次推理；不是手机实测或官方 VisDrone AP。',22)
text(d,(55,1115),'未参与评估的类别、其他目标及标注忽略区单独处理，完整口径与原始记录见报告。',22)
canvas.save(OUT/'figures/overview.png')

details=json.loads(gzip.decompress((OUT/'matches-holdout.json.gz').read_bytes()));image_map={i['imageId']:i for i in lock['images']};cases=[]
for name in NAMES:
    modes=details[f'{name}-fp32-webgpu'];whole={i['imageId']:i for i in modes['whole']['images']};combined={i['imageId']:i for i in modes['combined']['images']}
    criteria=[('gain','净小目标收益最高',lambda r:len(r['smallGainedGtIds'])-len(r['smallLostGtIds'])),('fp-cost','误检增量最高',lambda r:r['fp']-whole[r['imageId']]['fp']),('loss','小目标损失最多',lambda r:len(r['smallLostGtIds']))]
    for criterion,label,rank in criteria:
        chosen=sorted(modes['refined']['images'],key=lambda r:(-rank(r),r['imageId']))[0];iid=chosen['imageId'];meta=image_map[iid]
        photo=Image.open(Path(lock['imageRoot'])/meta['filename']).convert('RGB');ratio=min(640/photo.width,540/photo.height);photo=photo.resize((round(photo.width*ratio),round(photo.height*ratio)))
        canvas=Image.new('RGB',(2040,820),'#f7f9fc');d=ImageDraw.Draw(canvas)
        text(d,(30,25),f'{NAMES[name]} · {label} · {meta["filename"]}',30)
        text(d,(30,82),f'改进相对整图：小目标新增 {len(chosen["smallGainedGtIds"])}，丢失 {len(chosen["smallLostGtIds"])}；FP {whole[iid]["fp"]} → {chosen["fp"]}',23)
        for col,(label,row) in enumerate([('整图',whole[iid]),('原始组合',combined[iid]),('改进组合',chosen)]):
            x=30+col*680;y=205;text(d,(x,145),label,27);canvas.paste(photo,(x,y))
            for det in sorted(row['detections'],key=lambda r:r['score']):
                if det['status']=='ignored':continue
                a,b,w,h=det['bbox'];d.rectangle((x+a*ratio,y+b*ratio,x+(a+w)*ratio,y+(b+h)*ratio),outline='#00df81' if det['status']=='tp' else '#ff4040',width=2)
            text(d,(x,720),f'小目标 {len(row["smallMatchedGtIds"])} · TP {row["tp"]} · FP {row["fp"]}',23)
        text(d,(30,777),'绿框：匹配成功；红框：未匹配；只显示评估范围内 score ≥ 0.5 的框。照片仅保留本地用于研究。',20)
        filename=f'{name}-{criterion}-{iid}.jpg';canvas.save(OUT/'figures'/filename,quality=92)
        cases.append(dict(name=name,criterion=criterion,label=label,imageId=iid,filename=meta['filename'],score=rank(chosen),smallGained=chosen['smallGainedGtIds'],smallLost=chosen['smallLostGtIds'],fpWhole=whole[iid]['fp'],fpCombined=combined[iid]['fp'],fpRefined=chosen['fp'],file=f'figures/{filename}'))
(OUT/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
print('已生成全部对照、独立集总览和按固定规则选择的6个案例')
