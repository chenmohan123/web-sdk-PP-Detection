import { describe, expect, it } from "vitest";
import { PPDetectionError } from "../src/errors";
import { parseDetectionManifest } from "../src/model/manifest";

const valid = {
  schemaVersion: 1,
  model: { id: "pp-picodet-l-320", version: "1.0.0" },
  input: { name: "image", shape: [1, 3, 320, 320], dtype: "float32" },
  outputs: [{ name: "dets", shape: [1, 100, 6], dtype: "float32" }],
  preprocessing: { size: { width: 320, height: 320 }, rescaleFactor: 1 / 255 },
  postprocessing: { type: "nms", scoreThreshold: 0.4, iouThreshold: 0.5 },
  labels: ["person"],
  variants: [
    {
      id: "fp32",
      precision: "fp32",
      quantization: null,
      opset: 11,
      bytes: 10,
      parameterCount: 1,
      backends: ["wasm"],
      sources: [
        {
          kind: "git-lfs",
          repository: "repo",
          revision: "a".repeat(40),
          path: "m.onnx",
          downloadUrl: "https://example.com/m.onnx",
          bytes: 10,
          sha256: "a".repeat(64)
        }
      ]
    }
  ]
};

describe("parseDetectionManifest", () => {
  it("缺少 tensor、预处理或后处理时拒绝", () => {
    expect(() => parseDetectionManifest({ ...valid, input: undefined })).toThrow();
    expect(() => parseDetectionManifest({ ...valid, preprocessing: undefined })).toThrow();
    expect(() => parseDetectionManifest({ ...valid, postprocessing: undefined })).toThrow();
  });
  it("接受完整清单并保留变体来源", () => {
    expect(parseDetectionManifest(valid).variants[0].sources[0].kind).toBe("git-lfs");
  });

  it("允许输出契约使用 -1 表示运行时可变维度", () => {
    const parsed = parseDetectionManifest({
      ...valid,
      outputs: [{ name: "dets", shape: [-1, 6], dtype: "float32" }]
    });

    expect(parsed.outputs[0]?.shape).toEqual([-1, 6]);
  });

  it.each([
    ["变体大小", { ...valid, variants: [{ ...valid.variants[0], bytes: undefined }] }],
    [
      "来源大小",
      {
        ...valid,
        variants: [
          { ...valid.variants[0], sources: [{ ...valid.variants[0].sources[0], bytes: undefined }] }
        ]
      }
    ],
    [
      "下载地址",
      {
        ...valid,
        variants: [
          {
            ...valid.variants[0],
            sources: [{ ...valid.variants[0].sources[0], downloadUrl: undefined }]
          }
        ]
      }
    ],
    [
      "SHA-256",
      {
        ...valid,
        variants: [
          {
            ...valid.variants[0],
            sources: [{ ...valid.variants[0].sources[0], sha256: undefined }]
          }
        ]
      }
    ]
  ])("缺少%s时返回稳定清单错误", (_name, candidate) => {
    expect(() => parseDetectionManifest(candidate)).toThrowError(
      expect.objectContaining<Partial<PPDetectionError>>({ code: "INVALID_MANIFEST" })
    );
  });

  it("拒绝浮动 revision、非 HTTP(S) 地址和来源大小不一致", () => {
    const source = valid.variants[0].sources[0];
    expect(() =>
      parseDetectionManifest({
        ...valid,
        variants: [{ ...valid.variants[0], sources: [{ ...source, revision: "main" }] }]
      })
    ).toThrow();
    expect(() =>
      parseDetectionManifest({
        ...valid,
        variants: [
          { ...valid.variants[0], sources: [{ ...source, downloadUrl: "file:///m.onnx" }] }
        ]
      })
    ).toThrow();
    expect(() =>
      parseDetectionManifest({
        ...valid,
        variants: [{ ...valid.variants[0], sources: [{ ...source, bytes: 9 }] }]
      })
    ).toThrow();
  });

  it("拒绝包含非有限数值的归一化参数", () => {
    expect(() =>
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, mean: [0, "bad", 0] }
      })
    ).toThrow();
    expect(() =>
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, std: [1, Number.NaN, 1] }
      })
    ).toThrow();
  });

  it("归一化参数必须匹配输入通道数且 std 必须大于零", () => {
    expect(() =>
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, mean: [0, 0] }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
    expect(() =>
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, std: [1, 0, 1] }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
  });

  it("预处理开关和输出坐标格式必须使用受支持的类型", () => {
    expect(() =>
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, doResize: "yes" }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
    expect(() =>
      parseDetectionManifest({
        ...valid,
        postprocessing: { ...valid.postprocessing, matrixCoordinates: "unit" }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
    expect(() =>
      parseDetectionManifest({
        ...valid,
        postprocessing: { ...valid.postprocessing, queryBoxFormat: "yolo" }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
    expect(() =>
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, resizeMode: "crop" }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
  });

  it("保留 stretch 预处理模式", () => {
    expect(
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, resizeMode: "stretch" }
      }).preprocessing.resizeMode
    ).toBe("stretch");
  });

  it("保留 bicubic 插值模式", () => {
    expect(
      parseDetectionManifest({
        ...valid,
        preprocessing: { ...valid.preprocessing, interpolation: "bicubic" }
      }).preprocessing.interpolation
    ).toBe("bicubic");
  });
});
