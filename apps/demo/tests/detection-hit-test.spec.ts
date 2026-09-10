import { expect, test } from "playwright/test";
import { hitTestDetection } from "../src/detection-hit-test";

test("重叠目标优先命中较小框，边界可选，同面积时保持结果顺序", () => {
  const detections = [
    { id: "大框", box: { xMin: 10, yMin: 10, xMax: 190, yMax: 90 } },
    { id: "小框", box: { xMin: 50, yMin: 30, xMax: 80, yMax: 60 } },
    { id: "同位置", box: { xMin: 50, yMin: 30, xMax: 80, yMax: 60 } }
  ];
  const image = { width: 200, height: 100 };
  const viewport = { width: 400, height: 400 };
  expect(hitTestDetection(detections, image, viewport, { x: 100, y: 160 })?.id).toBe("小框");
  expect(hitTestDetection(detections, image, viewport, { x: 300, y: 200 })?.id).toBe("大框");
  expect(hitTestDetection(detections, image, viewport, { x: 150, y: 80 })).toBeUndefined();
  expect(hitTestDetection([], image, viewport, { x: 100, y: 160 })).toBeUndefined();
});

test("横向留白及缩小后的原图坐标正确，无尺寸画布不命中", () => {
  const detections = [{ box: { xMin: 40, yMin: 80, xMax: 60, yMax: 120 } }];
  const image = { width: 100, height: 200 };
  expect(hitTestDetection(detections, image, { width: 300, height: 100 }, { x: 150, y: 50 })).toBe(
    detections[0]
  );
  expect(
    hitTestDetection(detections, image, { width: 300, height: 100 }, { x: 25, y: 50 })
  ).toBeUndefined();
  expect(
    hitTestDetection(detections, image, { width: 0, height: 0 }, { x: 0, y: 0 })
  ).toBeUndefined();
});
