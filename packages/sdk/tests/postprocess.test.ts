import { describe, expect, it } from "vitest";
import { decodeDetectionOutputs } from "../src/detection/decode-output";
import { nonMaximumSuppression } from "../src/detection/nms";

const transform = {
  inputWidth: 4,
  inputHeight: 4,
  originalWidth: 4,
  originalHeight: 2,
  resizedWidth: 4,
  resizedHeight: 2,
  scale: 1,
  padLeft: 0,
  padTop: 1
};

const declaredOutputs = [
  { name: "arbitrary_matrix", shape: [3, 6], dtype: "float32" },
  { name: "arbitrary_logits", shape: [1, 1, 1], dtype: "float32" },
  { name: "arbitrary_boxes", shape: [1, 1, 4], dtype: "float32" }
];

describe("nonMaximumSuppression", () => {
  it("只抑制同类别的重叠框并保留稳定原始 index", () => {
    const detections = nonMaximumSuppression(
      [
        { index: 0, classId: 0, score: 0.9, box: { xMin: 0, yMin: 0, xMax: 2, yMax: 2 } },
        { index: 1, classId: 0, score: 0.8, box: { xMin: 0, yMin: 0, xMax: 2, yMax: 2 } },
        { index: 2, classId: 1, score: 0.7, box: { xMin: 0, yMin: 0, xMax: 2, yMax: 2 } }
      ],
      0.5
    );

    expect(detections.map((item) => item.index)).toEqual([0, 2]);
  });
});

describe("decodeDetectionOutputs", () => {
  it("接受阈值边界、执行 NMS、去除 letterbox 并裁剪到原图像素", () => {
    const result = decodeDetectionOutputs(
      {
        dets: {
          data: new Float32Array([0, 0.5, -1, 1, 5, 3, 0, 0.49, 0, 1, 4, 3, 0, 0.5, 0, 1, 4, 3]),
          dims: [3, 6]
        }
      },
      {
        labels: ["person"],
        scoreThreshold: 0.5,
        iouThreshold: 0.5,
        transform
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ index: 0, classId: 0, label: "person", score: 0.5 });
    expect(result[0]?.box).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 2,
      xMin: 0,
      yMin: 0,
      xMax: 4,
      yMax: 2
    });
  });

  it("空输出返回空检测数组", () => {
    expect(
      decodeDetectionOutputs(
        { dets: { data: new Float32Array(), dims: [0, 6] } },
        { labels: ["person"], scoreThreshold: 0.5, iouThreshold: 0.5, transform }
      )
    ).toEqual([]);
  });

  it("支持 logits 与归一化 cxcywh 框输出", () => {
    const result = decodeDetectionOutputs(
      {
        logits: { data: new Float32Array([4]), dims: [1, 1, 1] },
        pred_boxes: { data: new Float32Array([0.5, 0.5, 1, 0.5]), dims: [1, 1, 4] }
      },
      {
        labels: ["text"],
        scoreThreshold: 0.5,
        iouThreshold: 0.5,
        transform
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.box).toMatchObject({ xMin: 0, yMin: 0, xMax: 4, yMax: 2 });
  });

  it("按 manifest shape 解码任意名称的矩阵输出，并将坐标按像素处理", () => {
    const result = decodeDetectionOutputs(
      { arbitrary_matrix: { data: new Float32Array([0, 0.9, 0, 1, 1, 2]), dims: [1, 6] } },
      {
        labels: ["text"],
        scoreThreshold: 0.5,
        iouThreshold: 0.5,
        transform,
        outputs: [{ name: "arbitrary_matrix", shape: [1, 6], dtype: "float32" }]
      }
    );

    expect(result[0]?.box).toMatchObject({ xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
  });

  it("按动态输出维度解码运行时少于静态上限的检测矩阵", () => {
    const result = decodeDetectionOutputs(
      { arbitrary_matrix: { data: new Float32Array([0, 0.9, 0, 1, 1, 2]), dims: [1, 6] } },
      {
        labels: ["text"],
        scoreThreshold: 0.5,
        iouThreshold: 0.5,
        transform,
        outputs: [{ name: "arbitrary_matrix", shape: [-1, 6], dtype: "float32" }],
        matrixCoordinates: "pixels"
      }
    );

    expect(result).toHaveLength(1);
  });

  it("按 manifest shape 解码任意名称的 logits 与 xyxy 框", () => {
    const result = decodeDetectionOutputs(
      {
        arbitrary_logits: { data: new Float32Array([4]), dims: [1, 1, 1] },
        arbitrary_boxes: { data: new Float32Array([0, 1, 4, 3]), dims: [1, 1, 4] }
      },
      {
        labels: ["text"],
        scoreThreshold: 0.5,
        iouThreshold: 0.5,
        transform,
        outputs: declaredOutputs,
        queryCoordinates: "pixels",
        queryBoxFormat: "xyxy"
      }
    );

    expect(result[0]?.box).toMatchObject({ xMin: 0, yMin: 0, xMax: 4, yMax: 2 });
  });

  it("malformed ORT output 返回 INFERENCE_FAILED", () => {
    expect(() =>
      decodeDetectionOutputs(
        { dets: {} },
        {
          labels: ["text"],
          scoreThreshold: 0.5,
          iouThreshold: 0.5,
          transform
        }
      )
    ).toThrowError(expect.objectContaining({ code: "INFERENCE_FAILED" }));
  });

  it("提供 manifest outputs 时不根据未声明的输出名称猜测检测张量", () => {
    expect(() =>
      decodeDetectionOutputs(
        { arbitrary_name: { data: new Float32Array([0, 0.9, 0, 1, 1, 2]), dims: [1, 6] } },
        {
          labels: ["text"],
          scoreThreshold: 0.5,
          iouThreshold: 0.5,
          transform,
          outputs: [{ name: "declared_detection", shape: [1, 6], dtype: "float32" }]
        }
      )
    ).toThrowError(expect.objectContaining({ code: "INFERENCE_FAILED" }));
  });

  it("非整数 resize 后使用实际横纵缩放比例还原坐标", () => {
    const nonUniformTransform = {
      ...transform,
      originalWidth: 3,
      originalHeight: 2,
      resizedWidth: 4,
      resizedHeight: 3,
      scale: 4 / 3,
      scaleX: 4 / 3,
      scaleY: 3 / 2,
      padTop: 0
    };
    const result = decodeDetectionOutputs(
      { dets: { data: new Float32Array([0, 0.9, 0, 0, 4, 3]), dims: [1, 6] } },
      {
        labels: ["text"],
        scoreThreshold: 0.5,
        iouThreshold: 0.5,
        transform: nonUniformTransform
      }
    );
    expect(result[0]?.box).toMatchObject({ xMax: 3, yMax: 2 });
  });
});
