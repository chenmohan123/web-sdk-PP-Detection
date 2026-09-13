// 一次性实验；所有候选保留整图结果，只决定如何接纳切片补充。
import {iou,mergeDetections} from '../../2026-09-12-tiling/reproduction/tiling.mjs';
export const strategies=['whole-first','edge-contained','small-additions','confident-anchor'];
export function containment(a,b){
  const inter=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const denominator=Math.min(a.width*a.height,b.width*b.height);
  return denominator>0?inter/denominator:0;
}
export function internalEdge(box,tile,width,height){
  return (tile.x>0&&box.x-tile.x<=tile.width*.02)||(tile.y>0&&box.y-tile.y<=tile.height*.02)||(tile.x+tile.width<width&&tile.x+tile.width-box.x-box.width<=tile.width*.02)||(tile.y+tile.height<height&&tile.y+tile.height-box.y-box.height<=tile.height*.02);
}
export function refine(image,strategy){
  if(!strategies.includes(strategy))throw new Error('未知合并策略');
  if(strategy==='confident-anchor'){
    const strong=image.whole.filter(d=>d.score>=.5),weak=image.whole.filter(d=>d.score<.5);
    const filtered=refine({...image,whole:strong},'edge-contained');
    const rest=mergeDetections([...weak,...filtered.detections.slice(strong.length)]).filter(d=>!strong.some(s=>s.classId===d.classId&&iou(s.box,d.box)>.5));
    return {detections:[...strong,...rest],trace:filtered.trace};
  }
  const selected=[...image.whole],trace=[],groups=new Map();
  for(const d of selected){const group=groups.get(d.classId)??[];group.push(d);groups.set(d.classId,group);}
  const candidates=image.tiles.flatMap((t,tileIndex)=>t.projected.map((d,index)=>({...d,tile:t.tile,tileIndex,index}))).sort((a,b)=>b.score-a.score);
  for(const c of candidates){
    let reason=null;
    if(strategy!=='whole-first'&&internalEdge(c.box,c.tile,image.width,image.height))reason='internal-edge';
    if(!reason&&strategy==='small-additions'&&(c.box.width>image.width*.25||c.box.height>image.height*.25))reason='large-fragment';
    const group=groups.get(c.classId)??[];
    if(!reason&&group.some(d=>iou(d.box,c.box)>.5))reason='iou';
    if(!reason&&strategy!=='whole-first'&&group.some(d=>d.score>=.5&&containment(d.box,c.box)>.8))reason='contained';
    trace.push({tileIndex:c.tileIndex,index:c.index,classId:c.classId,score:c.score,box:c.box,reason:reason??'accepted'});
    if(!reason){const d={classId:c.classId,score:c.score,box:c.box};selected.push(d);group.push(d);groups.set(c.classId,group);}
  }
  return {detections:selected,trace};
}
export function originalCombined(image){return mergeDetections([...image.whole,...image.tiles.flatMap(t=>t.projected)]);}
