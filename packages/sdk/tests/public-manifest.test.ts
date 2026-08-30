import { describe, expect, it } from "vitest";
import { adaptModelManifest, parseModelManifest } from "../src/model/public-manifest";

const manifest = {
  schemaVersion: 1,
  minSdkVersion: "0.1.0",
  model: {
    architecture: "PicoDetFixture",
    id: "picodet-fixture",
    modelType: "pp_detection",
    parameterCount: 12,
    version: "1.0.0"
  },
  input: { dtype: "float32", name: "image", shape: [1, 3, 2, 2] },
  outputs: [{ dtype: "float32", name: "dets", shape: [1, 6] }],
  preprocessing: {
    doNormalize: true,
    doRescale: true,
    doResize: true,
    imageMean: [0, 0, 0],
    imageStd: [1, 1, 1],
    resample: 2,
    rescaleFactor: 1 / 255,
    size: { height: 2, width: 2 }
  },
  source: {
    files: { "model.onnx": "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a" },
    license: "Apache-2.0",
    name: "fixture",
    url: "https://example.com/repository"
  },
  labels: ["person"],
  variantPriority: ["fp32"],
  variants: [
    {
      backendCompatibility: ["wasm"],
      bytes: 4,
      filename: "model.onnx",
      id: "fp32",
      opset: 11,
      precision: "fp32",
      sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
      url: "https://example.com/model.onnx",
      validation: { included: true, pass: true, report: "fixture" }
    }
  ]
};

describe("公开 ModelManifest 兼容层", () => {
  it("解析旧式 manifest 并适配为隔离的 runtime manifest", () => {
    const parsed = parseModelManifest(manifest);
    const runtime = adaptModelManifest(parsed);

    expect(runtime).toMatchObject({
      model: { id: "picodet-fixture", version: "1.0.0" },
      preprocessing: {
        size: { width: 2, height: 2 },
        mean: [0, 0, 0],
        std: [1, 1, 1]
      },
      postprocessing: { type: "nms", scoreThreshold: 0.5, iouThreshold: 0.5 }
    });
    expect(runtime.variants[0]).toMatchObject({
      id: "fp32",
      backends: ["wasm"],
      status: "stable",
      sources: [{ kind: "custom", revision: manifest.variants[0].sha256 }]
    });
  });

  it("拒绝 SHA、大小和输入通道不完整的自定义 manifest", () => {
    expect(() =>
      parseModelManifest({
        ...manifest,
        variants: [{ ...manifest.variants[0], sha256: "bad" }]
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
    expect(() =>
      parseModelManifest({ ...manifest, input: { ...manifest.input, shape: [1, 1, 2, 2] } })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
  });

  it("允许未知参数量并在 runtime manifest 中保留 null", () => {
    const parsed = parseModelManifest({
      ...manifest,
      model: { ...manifest.model, parameterCount: null }
    });
    expect(parsed.model.parameterCount).toBeNull();
    expect(adaptModelManifest(parsed).variants[0]?.parameterCount).toBeNull();
  });

  it("按 variantPriority 排序并保留量化声明", () => {
    const parsed = parseModelManifest({
      ...manifest,
      variantPriority: ["int8", "fp32"],
      variants: [
        manifest.variants[0],
        {
          ...manifest.variants[0],
          id: "int8",
          precision: "int8",
          quantization: "static-qdq"
        }
      ]
    });
    const runtime = adaptModelManifest(parsed);
    expect(runtime.variants.map((variant) => variant.id)).toEqual(["int8", "fp32"]);
    expect(runtime.variants[0]?.quantization).toBe("static-qdq");
  });

  it("将 legacy resample=3 适配为 bicubic", () => {
    const runtime = adaptModelManifest(
      parseModelManifest({
        ...manifest,
        preprocessing: { ...manifest.preprocessing, resample: 3 }
      })
    );

    expect(runtime.preprocessing.interpolation).toBe("bicubic");
  });

  it("显式 interpolation 优先于 legacy resample", () => {
    const runtime = adaptModelManifest(
      parseModelManifest({
        ...manifest,
        preprocessing: { ...manifest.preprocessing, resample: 3, interpolation: "bilinear" }
      })
    );

    expect(runtime.preprocessing.interpolation).toBe("bilinear");
  });

  it("拒绝未实现的 legacy resample", () => {
    expect(() =>
      parseModelManifest({
        ...manifest,
        preprocessing: { ...manifest.preprocessing, resample: 1 }
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_MANIFEST" }));
  });

  it("将 legacy resample=2 适配为 bilinear", () => {
    const runtime = adaptModelManifest(parseModelManifest(manifest));

    expect(runtime.preprocessing.interpolation).toBe("bilinear");
  });

  it("直接适配时也拒绝未实现的 legacy resample", () => {
    const parsed = parseModelManifest(manifest);
    const invalid = {
      ...parsed,
      preprocessing: { ...parsed.preprocessing, resample: 1 }
    } as Parameters<typeof adaptModelManifest>[0];

    expect(() => adaptModelManifest(invalid)).toThrowError(
      expect.objectContaining({ code: "INVALID_MANIFEST" })
    );
  });
});
