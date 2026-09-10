import { expect, test } from "playwright/test";
import { layoutDetectionLabels, type LabelBox } from "../src/label-layout";

function overlaps(first: LabelBox, second: LabelBox): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

test("密集检测框的标签保持在画布内且尽量不重叠", () => {
  const boxes = [
    { xMin: 30, yMin: 30, xMax: 170, yMax: 180 },
    { xMin: 100, yMin: 40, xMax: 240, yMax: 190 },
    { xMin: 170, yMin: 50, xMax: 290, yMax: 200 }
  ];
  const labels = layoutDetectionLabels(boxes, [90, 90, 90], 320, 240, 24, 4);

  expect(labels).toHaveLength(boxes.length);
  for (const label of labels) {
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(320);
    expect(label.y + label.height).toBeLessThanOrEqual(240);
  }
  for (const [index, label] of labels.entries()) {
    for (const previous of labels.slice(0, index)) expect(overlaps(label, previous)).toBe(false);
  }
});

test("四周均有标签时选择遮挡面积最小的位置", () => {
  const box = { xMin: 100, yMin: 100, xMax: 180, yMax: 180 };
  const labels = layoutDetectionLabels(
    Array(5).fill(box),
    [100, 40, 100, 100, 100],
    300,
    260,
    40,
    4
  );

  // 下方仅遮挡窄标签，其余三个位置都会完整盖住已有标签。
  expect(labels[4]).toEqual({ x: 100, y: 184, width: 100, height: 40 });
});

test("边缘检测和超长标签均限制在图片范围内", () => {
  const boxes = [
    { xMin: 0, yMin: 0, xMax: 30, yMax: 40 },
    { xMin: 295, yMin: 235, xMax: 320, yMax: 240 }
  ];
  const labels = layoutDetectionLabels(boxes, [500, 90], 320, 240, 24, 4);

  expect(labels[0]).toEqual({ x: 0, y: 0, width: 320, height: 24 });
  expect(labels[1]).toEqual({ x: 230, y: 207, width: 90, height: 24 });
  expect(layoutDetectionLabels(boxes, [500, 90], 320, 240, 24, 4)).toEqual(labels);
});

test("极小图片保留所有标签，空检测返回空布局", () => {
  const boxes = [
    { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
    { xMin: 0, yMin: 0, xMax: 1, yMax: 1 }
  ];
  expect(layoutDetectionLabels(boxes, [80, 100], 1, 1, 24, 4)).toEqual([
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 1, height: 1 }
  ]);
  expect(layoutDetectionLabels([], [], 320, 240, 24, 4)).toEqual([]);
});
