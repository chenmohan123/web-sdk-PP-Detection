import { describe, expect, it } from "vitest";
import type { Detection } from "../src/types";
import {
  cropImageTile,
  smallObjectTiles,
  projectTileDetection,
  mergeSmallObjectDetections
} from "../src/detection/small-objects";

function detection(
  x: number,
  y: number,
  width: number,
  height: number,
  score = 0.8,
  classId = 0
): Detection {
  return {
    index: 0,
    classId,
    labelId: classId,
    label: String(classId),
    score,
    box: { x, y, width, height, xMin: x, yMin: y, xMax: x + width, yMax: y + height },
    polygon: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ]
  };
}

describe("小目标增强几何与合并边界", () => {
  it("长条和极小图只产生有效切片，右下角逐行裁切保持 RGBA 原值", () => {
    expect(smallObjectTiles(1, 18)).toEqual([
      { x: 0, y: 0, width: 1, height: 10 },
      { x: 0, y: 8, width: 1, height: 10 }
    ]);
    expect(smallObjectTiles(2, 2)).toEqual([]);
    const rgba = new Uint8ClampedArray(Array.from({ length: 4 * 3 * 4 }, (_, i) => i));
    const cropped = cropImageTile(
      { width: 4, height: 3, rgba },
      { x: 2, y: 1, width: 2, height: 2 }
    );
    expect([...cropped.rgba]).toEqual([
      24, 25, 26, 27, 28, 29, 30, 31, 40, 41, 42, 43, 44, 45, 46, 47
    ]);
    cropped.rgba[0] = 0;
    expect(rgba[24]).toBe(24);
  });

  it("投影同步 box 与 polygon，输入局部坐标不被修改", () => {
    const local = detection(1, 2, 3, 4);
    const result = projectTileDetection(local, { x: 8, y: 8, width: 10, height: 10 });
    expect(result.box).toEqual({
      x: 9,
      y: 10,
      width: 3,
      height: 4,
      xMin: 9,
      yMin: 10,
      xMax: 12,
      yMax: 14
    });
    expect(result.polygon).toEqual([
      { x: 9, y: 10 },
      { x: 12, y: 10 },
      { x: 12, y: 14 },
      { x: 9, y: 14 }
    ]);
    expect(local.box.x).toBe(1);
  });

  it("包含抑制只影响同类，原图外边缘保留，内部边缘剔除", () => {
    const whole = [detection(0, 0, 18, 18)];
    const atOuter = detection(0, 0, 3, 3, 0.9, 1);
    const result = mergeSmallObjectDetections(
      whole,
      [
        {
          tile: { x: 0, y: 0, width: 10, height: 10 },
          detections: [detection(0, 0, 3, 3), atOuter, detection(7, 7, 3, 3, 0.9, 1)]
        }
      ],
      18,
      18
    );
    expect(result).toEqual([...whole, atOuter]);
  });

  it("保留强整图且同分切片采用输入顺序，不使用跨切片重复的 index", () => {
    const a = { ...detection(7, 3, 3, 3), index: 12 };
    const b = { ...detection(7, 3, 3, 3), index: 0 };
    const result = mergeSmallObjectDetections(
      [],
      [
        { tile: { x: 0, y: 0, width: 12, height: 12 }, detections: [a] },
        { tile: { x: 6, y: 0, width: 12, height: 12 }, detections: [b] }
      ],
      18,
      18
    );
    expect(result).toEqual([a]);
    const whole = [detection(0, 0, 12, 12), detection(1, 1, 12, 12)];
    expect(mergeSmallObjectDetections(whole, [], 18, 18)).toEqual(whole);
  });
});
