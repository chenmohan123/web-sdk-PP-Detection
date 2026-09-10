type Size = { width: number; height: number };
type Box = { xMin: number; yMin: number; xMax: number; yMax: number };

export function hitTestDetection<T extends { box: Box }>(
  detections: readonly T[],
  image: Size,
  viewport: Size,
  point: { x: number; y: number }
): T | undefined {
  if (image.width <= 0 || image.height <= 0) return undefined;
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  // object-fit: contain 将图片居中，先扣除四周留白，再还原原图坐标。
  const x = (point.x - (viewport.width - image.width * scale) / 2) / scale;
  const y = (point.y - (viewport.height - image.height * scale) / 2) / scale;
  if (x < 0 || y < 0 || x > image.width || y > image.height) return undefined;
  let selected: T | undefined;
  let smallestArea = Infinity;
  for (const detection of detections) {
    const { xMin, yMin, xMax, yMax } = detection.box;
    const area = (xMax - xMin) * (yMax - yMin);
    if (x >= xMin && x <= xMax && y >= yMin && y <= yMax && area > 0 && area < smallestArea) {
      selected = detection;
      smallestArea = area;
    }
  }
  return selected;
}
