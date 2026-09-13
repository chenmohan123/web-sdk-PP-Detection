"""由真实评估输出生成静态对比图和按固定规则选择的收益/失败案例。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import gzip, json

OUT=Path(__file__).resolve().parents[1]
ROOT=Path(__file__).resolve().parents[4]
FONT='C:/Windows/Fonts/msyh.ttc'
def font(size):return ImageFont.truetype(FONT,size)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def text(draw,xy,value,size=22,fill='#24324a'):draw.text(xy,str(value),font=font(size),fill=fill)
MODES={'whole':'整图','tiles':'仅切片','combined':'整图＋切片'}
NAMES={'picodet':'PicoDet L 320','ppyoloe':'PP-YOLOE+ S 640'}
COLORS={'whole':'#64748b','tiles':'#0891b2','combined':'#7c3aed'}

def make_chart(summary):
    rows=[r for r in summary['rows'] if r['backend']=='webgpu' and r['variant']=='fp32']
    image=Image.new('RGB',(1700,1080),'#f7f9fc');d=ImageDraw.Draw(image)
    text(d,(55,30),'切片能找回多少小目标，要付出多少代价？',40)
    text(d,(55,90),'正式 SDK 0.3.2 · COCO 固定 64 图 · 399 个小目标 · 桌面 WebGPU / FP32',23)
    specs=[('小目标 AP（%）',lambda r:r['metrics']['APSmall']*100,'{:.1f}',False),('小目标命中（/399）',lambda r:r['operating']['smallTp'],'{:.0f}',False),('误检框（FP）',lambda r:r['operating']['fp'],'{:.0f}',True),('每图耗时中位数（ms）',lambda r:r['timeMs']['median'],'{:.0f}',True)]
    for col,(title,value,fmt,lower) in enumerate(specs):
        x=55+col*410
        text(d,(x,160),title,26)
        text(d,(x,202),'越低越好' if lower else '越高越好',18,fill='#64748b')
        limit=max(value(r) for r in rows)*1.1
        for group,name in enumerate(['picodet','ppyoloe']):
            y=267+group*325;text(d,(x,y-24),NAMES[name],24)
            for pos,mode in enumerate(MODES):
                row=next(r for r in rows if r['name']==name and r['mode']==mode);v=value(row);by=y+40+pos*80
                text(d,(x,by-26),MODES[mode],17,fill=COLORS[mode])
                d.rounded_rectangle((x,by,x+max(1,285*v/limit),by+24),radius=6,fill=COLORS[mode])
                text(d,(x+295,by-5),fmt.format(v),21)
    text(d,(55,944),'命中与误检：score ≥ 0.5、IoU ≥ 0.5；AP 使用 score ≥ 0.001 和官方 COCOeval。',22)
    text(d,(55,986),'耗时来自单轮预热后实测；组合模式按同一组“整图＋四片”重建成本。样本最长边仅 640。',22)
    image.save(OUT/'figures/overview.png')

def make_cases(summary,details,inputs,dataset):
    gt={a['id']:a for a in dataset['annotations']};images={i['id']:i for i in dataset['images']}
    image_lock={i['imageId']:i for i in read(ROOT/'reports/evaluation/2026-09-11-ppyoloe/dataset/images.lock.json')}
    categories={c['id']:c['name'] for c in dataset['categories']}
    selected=[]
    # 预先固定选择规则：FP32 WebGPU；各模型选净小目标收益最高、丢失大目标最多、误检增量最高的图片；同分按 ID。
    rules=[('small-gain','净小目标收益最高',lambda b,c:len(c['smallGainedGtIds'])-len(c['smallLostGtIds'])),('large-loss','丢失大目标最多',lambda b,c:sum(gt[a]['area']>96**2 for a in c['lostGtIds'])),('fp-increase','误检增量最高',lambda b,c:c['fp']-b['fp'])]
    for name in NAMES:
        modes=details[f'{name}-fp32-webgpu'];baseline={i['imageId']:i for i in modes['whole']['images']}
        for rule,label,score in rules:
            chosen=sorted(modes['combined']['images'],key=lambda c:(-score(baseline[c['imageId']],c),c['imageId']))[0]
            image_id=chosen['imageId'];before=baseline[image_id];meta=images[image_id]
            photo=Image.open(Path(inputs['imageRoot'])/meta['file_name']).convert('RGB')
            canvas=Image.new('RGB',(2040,940),'#f7f9fc');d=ImageDraw.Draw(canvas)
            text(d,(35,24),f'{NAMES[name]} · {label} · COCO #{image_id}',33)
            text(d,(35,78),f'小目标新增 {len(chosen["smallGainedGtIds"])} / 丢失 {len(chosen["smallLostGtIds"])}；误检 {before["fp"]} → {chosen["fp"]}；大目标丢失 {sum(gt[a]["area"]>96**2 for a in chosen["lostGtIds"])}',23)
            for panel,(title,row) in enumerate([('整图',before),('整图＋切片',chosen),('标注变化',None)]):
                x=30+panel*680;y=200;scale=min(640/photo.width,640/photo.height)
                p=photo.resize((round(photo.width*scale),round(photo.height*scale)));canvas.paste(p,(x,y))
                text(d,(x,142),title,28)
                if row is not None:
                    for det in sorted(row['detections'],key=lambda a:a['score']):
                        if det['status']=='ignored':continue
                        a,b,w,h=det['bbox'];color='#00d37f' if det['status']=='tp' else '#ff4545'
                        d.rectangle((x+a*scale,y+b*scale,x+(a+w)*scale,y+(b+h)*scale),outline=color,width=2)
                    text(d,(x,852),f'TP {row["tp"]} · FP {row["fp"]} · 小目标 {len(row["smallMatchedGtIds"])}',23)
                else:
                    for ids,color in [(chosen['smallGainedGtIds'],'#00d37f'),(chosen['smallLostGtIds'],'#ff4545'),([a for a in chosen['lostGtIds'] if gt[a]['area']>96**2],'#ffb020')]:
                        for gid in ids:
                            a,b,w,h=gt[gid]['bbox'];d.rectangle((x+a*scale,y+b*scale,x+(a+w)*scale,y+(b+h)*scale),outline=color,width=3)
                    text(d,(x,852),'绿：新增小目标；红：丢失小目标',21)
                    text(d,(x,881),'橙：丢失大目标',21)
            text(d,(35,907),'前两列：绿框 = COCO 匹配成功，红框 = 未匹配（含重复、类别或定位错误）；显示 score ≥ 0.5。',18)
            filename=f'{name}-{rule}-{image_id}.jpg';canvas.save(OUT/'figures'/filename,quality=92)
            selected.append(dict(model=name,rule=rule,selection=label,imageId=image_id,selectionValue=score(before,chosen),file=f'figures/{filename}',smallGainedGtIds=chosen['smallGainedGtIds'],smallLostGtIds=chosen['smallLostGtIds'],lostLargeGtIds=[a for a in chosen['lostGtIds'] if gt[a]['area']>96**2],fpBefore=before['fp'],fpAfter=chosen['fp'],source=image_lock[image_id]))
    (OUT/'cases.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2),encoding='utf-8')

def make_table(summary):
    lines=['# 完整对照表','', 'AP 指标为百分数；命中和 FP 使用 score ≥ 0.5、IoU ≥ 0.5。耗时为毫秒。每个模型/精度/后端各 64 图一轮，统一预热一次。','']
    for backend in ['webgpu','wasm']:
        lines += [f'## {backend.upper()}','','| 模型 | 精度 | 模式 | AP | APSmall | APMedium | APLarge | 小目标命中 | 小目标新增/丢失 | TP | FP | 中位耗时 | P90 |','|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for r in summary['rows']:
            if r['backend']!=backend:continue
            m=r['metrics'];o=r['operating'];v=r.get('vsWhole');change=f'{v["smallGained"]}/{v["smallLost"]}' if v else '—'
            lines.append(f'| {NAMES[r["name"]]} | {r["variant"].upper()} | {MODES[r["mode"]]} | {m["AP"]*100:.2f} | {m["APSmall"]*100:.2f} | {m["APMedium"]*100:.2f} | {m["APLarge"]*100:.2f} | {o["smallTp"]}/399 | {change} | {o["tp"]} | {o["fp"]} | {r["timeMs"]["median"]:.1f} | {r["timeMs"]["p90"]:.1f} |')
        lines.append('')
    (OUT/'comparison.md').write_text('\n'.join(lines),encoding='utf-8')

if __name__=='__main__':
    summary=read(OUT/'summary.json');inputs=read(OUT/'inputs.json');dataset=read(Path(inputs['annotations']))
    details=json.loads(gzip.decompress((OUT/'matches.json.gz').read_bytes()))
    make_chart(summary);make_cases(summary,details,inputs,dataset);make_table(summary)
    print('已生成总览、完整 36 行对照表及按固定规则选择的 6 个案例')
