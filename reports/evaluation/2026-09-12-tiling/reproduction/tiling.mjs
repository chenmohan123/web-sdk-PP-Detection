// 一次性评估辅助函数，未接入 SDK 产品代码。
export function tileGrid(width, height) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('图片尺寸必须是正整数');
  const w = Math.ceil(width / 1.8), h = Math.ceil(height / 1.8);
  return [...new Set([0, height - h])].flatMap(y => [...new Set([0, width - w])].map(x => ({x, y, width:w, height:h})));
}

export function cropRaster(raster, tile) {
  const rgba = new Uint8ClampedArray(tile.width * tile.height * 4);
  for (let y = 0; y < tile.height; y++) {
    const offset = ((y + tile.y) * raster.width + tile.x) * 4;
    rgba.set(raster.rgba.subarray(offset, offset + tile.width * 4), y * tile.width * 4);
  }
  return {width:tile.width, height:tile.height, rgba};
}

export function projectDetection(detection, tile) {
  const {box} = detection;
  if (![box.x, box.y, box.width, box.height, detection.score].every(Number.isFinite)) throw new Error('预测包含非有限值');
  const x1 = Math.max(0, Math.min(tile.width, box.x));
  const y1 = Math.max(0, Math.min(tile.height, box.y));
  const x2 = Math.max(0, Math.min(tile.width, box.x + box.width));
  const y2 = Math.max(0, Math.min(tile.height, box.y + box.height));
  if (x2 <= x1 || y2 <= y1) return null;
  return {classId:detection.classId, score:detection.score, box:{x:x1+tile.x, y:y1+tile.y, width:x2-x1, height:y2-y1}};
}

export function iou(a, b) {
  const intersection = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const union = a.width*a.height+b.width*b.height-intersection;
  return union > 0 ? intersection/union : 0;
}

export function mergeDetections(candidates) {
  const selected = [], classes = new Map();
  for (const candidate of [...candidates].sort((a,b)=>b.score-a.score)) {
    const kept = classes.get(candidate.classId) ?? [];
    if (kept.some(other=>iou(other.box,candidate.box)>0.5)) continue;
    kept.push(candidate); classes.set(candidate.classId,kept); selected.push(candidate);
  }
  return selected;
}
