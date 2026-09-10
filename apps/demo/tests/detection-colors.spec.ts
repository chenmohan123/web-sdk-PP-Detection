import { expect, test } from "playwright/test";
import { detectionColor } from "../src/detection-colors";

test("同一类别使用稳定颜色，常见类别颜色不同", () => {
  expect(detectionColor("orange")).toBe(detectionColor("orange"));
  expect(detectionColor("orange")).not.toBe(detectionColor("person"));
});
