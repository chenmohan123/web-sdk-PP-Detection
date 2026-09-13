import type { ImageRaster } from "../input/image-source";
import type { Detection } from "../types";
import { intersectionOverUnion } from "./nms";

export interface ImageTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function smallObjectTiles(width: number, height: number): ImageTile[] {
  const tileWidth = Math.ceil(width / 1.8);
  const tileHeight = Math.ceil(height / 1.8);
  if (tileWidth === width && tileHeight === height) return [];
  return [...new Set([0, height - tileHeight])].flatMap((y) =>
    [...new Set([0, width - tileWidth])].map((x) => ({
      x,
      y,
      width: tileWidth,
      height: tileHeight
    }))
  );
}

export function cropImageTile(image: ImageRaster, tile: ImageTile): ImageRaster {
  const rgba = new Uint8ClampedArray(tile.width * tile.height * 4);
  for (let y = 0; y < tile.height; y++) {
    const start = ((y + tile.y) * image.width + tile.x) * 4;
    rgba.set(image.rgba.subarray(start, start + tile.width * 4), y * tile.width * 4);
  }
  return { width: tile.width, height: tile.height, rgba };
}

export function projectTileDetection(detection: Detection, tile: ImageTile): Detection {
  // decodeDetectionOutputs 已将局部框裁到切片边界，投影同步全部坐标表示。
  const { box } = detection;
  return {
    ...detection,
    box: {
      ...box,
      x: box.x + tile.x,
      y: box.y + tile.y,
      xMin: box.xMin + tile.x,
      xMax: box.xMax + tile.x,
      yMin: box.yMin + tile.y,
      yMax: box.yMax + tile.y
    },
    polygon: detection.polygon.map(({ x, y }) => ({ x: x + tile.x, y: y + tile.y }))
  };
}

function atInternalEdge(
  box: Detection["box"],
  tile: ImageTile,
  width: number,
  height: number
): boolean {
  return (
    (tile.x > 0 && box.xMin - tile.x <= tile.width * 0.02) ||
    (tile.y > 0 && box.yMin - tile.y <= tile.height * 0.02) ||
    (tile.x + tile.width < width && tile.x + tile.width - box.xMax <= tile.width * 0.02) ||
    (tile.y + tile.height < height && tile.y + tile.height - box.yMax <= tile.height * 0.02)
  );
}

function containment(a: Detection["box"], b: Detection["box"]): number {
  const intersection =
    Math.max(0, Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)) *
    Math.max(0, Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin));
  const denominator = Math.min(a.width * a.height, b.width * b.height);
  return denominator > 0 ? intersection / denominator : 0;
}

function overlaps(a: Detection, b: Detection): boolean {
  return a.classId === b.classId && intersectionOverUnion(a.box, b.box) > 0.5;
}

export function mergeSmallObjectDetections(
  whole: readonly Detection[],
  tiles: readonly { tile: ImageTile; detections: readonly Detection[] }[],
  width: number,
  height: number
): Detection[] {
  // 冻结自 2026-09-12 第二轮实验的 confident-anchor 策略。
  const strong = whole.filter(({ score }) => score >= 0.5);
  const selected = [...strong];
  const additions: Detection[] = [];
  const candidates = tiles
    .flatMap(({ tile, detections }) => detections.map((detection) => ({ tile, detection })))
    .sort((a, b) => b.detection.score - a.detection.score);
  for (const { tile, detection } of candidates) {
    if (atInternalEdge(detection.box, tile, width, height)) continue;
    if (
      selected.some(
        (kept) =>
          overlaps(kept, detection) ||
          (kept.classId === detection.classId &&
            kept.score >= 0.5 &&
            containment(kept.box, detection.box) > 0.8)
      )
    )
      continue;
    selected.push(detection);
    additions.push(detection);
  }
  // 使用稳定分数排序，不能按各片重复的模型输出 index 打破同分顺序。
  const rest: Detection[] = [];
  for (const detection of [...whole.filter(({ score }) => score < 0.5), ...additions].sort(
    (a, b) => b.score - a.score
  )) {
    if (!rest.some((kept) => overlaps(kept, detection))) rest.push(detection);
  }
  return [
    ...strong,
    ...rest.filter((detection) => !strong.some((kept) => overlaps(kept, detection)))
  ];
}
