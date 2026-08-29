import { describe, expect, it, vi } from "vitest";
import { PPDetectionError } from "../src/errors";
import { PPDetectionDetectorImplementation } from "../src/detection/detector";
import type { RuntimeDetectionManifest } from "../src/types";

const manifest: RuntimeDetectionManifest = {
  schemaVersion: 1,
  model: { id: "tiny-detection", version: "1.0.0" },
  input: { name: "image", shape: [1, 3, 2, 2], dtype: "float32" },
  outputs: [{ name: "dets", shape: [1, 6], dtype: "float32" }],
  preprocessing: { size: { width: 2, height: 2 }, rescaleFactor: 1 / 255 },
  postprocessing: { type: "nms", scoreThreshold: 0.5, iouThreshold: 0.5 },
  labels: ["person"],
  variants: [
    {
      id: "fp32",
      precision: "fp32",
      quantization: null,
      opset: 11,
      bytes: 4,
      parameterCount: 1,
      backends: ["wasm"],
      sources: [
        {
          kind: "custom",
          repository: "fixture",
          revision: "a".repeat(64),
          path: "tiny.onnx",
          downloadUrl: "https://fixture.invalid/tiny.onnx",
          bytes: 4,
          sha256: "a".repeat(64)
        }
      ]
    }
  ]
};

const capabilities = {
  webgpu: false,
  worker: false,
  offscreenCanvas: false,
  wasmSimd: true,
  wasmThreads: false
};

function createDetector() {
  const run = vi.fn(async () => ({
    dets: { data: new Float32Array([0, 0.75, 0, 0, 2, 2]), dims: [1, 6] }
  }));
  const dispose = vi.fn();
  const disposeResources = vi.fn();
  const detector = new PPDetectionDetectorImplementation({
    capabilities,
    manifest,
    model: {
      id: "tiny-detection",
      version: "1.0.0",
      variantId: "fp32",
      precision: "fp32",
      bytes: 4,
      parameterCount: 1,
      opset: 11,
      source: {
        kind: "custom",
        revision: "a".repeat(64),
        bytes: 4,
        sha256: "a".repeat(64)
      }
    },
    runtime: {
      requestedBackend: "wasm",
      backend: "wasm",
      precision: "fp32",
      mode: "main",
      fallbacks: [],
      capabilities
    },
    loadTimings: { sessionMs: 1, totalMs: 1 },
    loadExecutor: vi.fn(async () => ({ run, dispose })),
    disposeResources
  });
  return { detector, dispose, disposeResources, run };
}

describe("PPDetectionDetectorImplementation", () => {
  it("未加载时 detect 返回 SESSION_CREATE_FAILED", async () => {
    const { detector } = createDetector();
    await expect(
      detector.detect({ width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData)
    ).rejects.toMatchObject<Partial<PPDetectionError>>({ code: "SESSION_CREATE_FAILED" });
  });

  it("load 后串联单帧阶段并返回模型、运行时、原图尺寸和完整耗时", async () => {
    const { detector, run } = createDetector();
    await detector.load();
    const result = await detector.detect({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray(8).fill(255)
    } as ImageData);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ inputName: "image", dims: [1, 3, 2, 2] }),
      undefined
    );
    expect(result.detections[0]).toMatchObject({ classId: 0, label: "person", score: 0.75 });
    expect(result.image.original).toEqual({ width: 2, height: 1 });
    expect(result.model.id).toBe("tiny-detection");
    expect(result.model.source).toEqual({
      kind: "custom",
      revision: "a".repeat(64),
      bytes: 4,
      sha256: "a".repeat(64)
    });
    expect(result.model).not.toHaveProperty("downloadUrl");
    expect(result.runtime.backend).toBe("wasm");
    expect(result.timings).toEqual({
      decodeMs: expect.any(Number),
      preprocessMs: expect.any(Number),
      inferenceMs: expect.any(Number),
      postprocessMs: expect.any(Number),
      totalMs: expect.any(Number)
    });
  });

  it("预先取消的 detect 返回 ABORTED 且不执行推理", async () => {
    const { detector, run } = createDetector();
    await detector.load();
    const controller = new AbortController();
    controller.abort();
    await expect(
      detector.detect({ width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData, {
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(run).not.toHaveBeenCalled();
  });

  it("拒绝越界或非有限阈值", async () => {
    const { detector } = createDetector();
    await detector.load();
    const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;
    await expect(detector.detect(image, { threshold: Number.NaN })).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
    await expect(
      detector.detect(image, { classThresholds: { person: 1.1 } })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
    await expect(
      detector.detect(image, { classThresholds: { unknown: 0.5 } })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("dispose 只释放一次且后续 load/detect 返回 DISPOSED", async () => {
    const { detector, dispose, disposeResources } = createDetector();
    await detector.load();
    await detector.dispose();
    await detector.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(disposeResources).toHaveBeenCalledTimes(1);
    await expect(detector.load()).rejects.toMatchObject({ code: "DISPOSED" });
    await expect(
      detector.detect({ width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData)
    ).rejects.toMatchObject({ code: "DISPOSED" });
  });
});
