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
  expect(overlaps(labels[0], labels[1])).toBe(false);
  expect(overlaps(labels[1], labels[2])).toBe(false);
});
