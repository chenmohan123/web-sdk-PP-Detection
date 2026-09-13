import { describe, expect, it, vi } from "vitest";
import { PPDetectionError } from "../src/errors";
import { PPDetectionDetectorImplementation } from "../src/detection/detector";
import type { RuntimeDetectionManifest, DetectionProgress } from "../src/types";

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
  const loadExecutor = vi.fn(async () => ({ run, dispose }));
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
    loadExecutor,
    disposeResources
  });
  return { detector, dispose, disposeResources, run, loadExecutor };
}

describe("PPDetectionDetectorImplementation", () => {
  const image = { width: 18, height: 18, rgba: new Uint8ClampedArray(18 * 18 * 4) };

  it("默认一次推理；增强使用同一会话完成整图和四片并报告进度", async () => {
    const { detector, run, loadExecutor } = createDetector();
    await detector.load();
    await detector.detect(image);
    expect(run).toHaveBeenCalledTimes(1);
    run.mockClear();
    const progress: DetectionProgress[] = [];
    const result = await detector.detect(image, {
      smallObjectEnhancement: true,
      onProgress: (event) => progress.push(event)
    });
    expect(run).toHaveBeenCalledTimes(5);
    expect(loadExecutor).toHaveBeenCalledTimes(1);
    expect(progress.map(({ completed, total }) => [completed, total])).toEqual([
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5]
    ]);
    expect(result.smallObjectEnhancement).toEqual({ passes: 5 });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].box).toMatchObject({ x: 0, y: 0, width: 18, height: 18 });
    await detector.dispose();
  });

  it("低分整图不压制高分切片，最终阈值和类别阈值在合并后生效", async () => {
    const { detector, run } = createDetector();
    // 整图覆盖左上 9×9；切片覆盖其中 6×6，均避开切片内缘。
    run.mockResolvedValueOnce({
      dets: { data: new Float32Array([0, 0.4, 0, 0, 1, 1]), dims: [1, 6] }
    });
    run.mockResolvedValue({
      dets: { data: new Float32Array([0, 0.8, 0, 0, 1.2, 1.2]), dims: [1, 6] }
    });
    await detector.load();
    const result = await detector.detect(image, {
      smallObjectEnhancement: true,
      threshold: 0.9,
      classThresholds: { person: 0.7 }
    });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].score).toBeCloseTo(0.8);
    expect(result.detections[0].box).toMatchObject({ x: 0, y: 0 });
    expect(result.detections[0].box.width).toBeCloseTo(6);
    expect(result.detections[0].polygon[2].x).toBeCloseTo(6);
    await detector.dispose();
  });

  it("用户高阈值不会提前移除用于保护整图的强框", async () => {
    const { detector, run } = createDetector();
    run.mockResolvedValueOnce({
      dets: { data: new Float32Array([0, 0.6, 0, 0, 2, 2]), dims: [1, 6] }
    });
    run.mockResolvedValue({
      dets: { data: new Float32Array([0, 0.95, 0.2, 0.2, 1, 1]), dims: [1, 6] }
    });
    await detector.load();
    const result = await detector.detect(image, { smallObjectEnhancement: true, threshold: 0.9 });
    expect(result.detections).toEqual([]);
    await detector.dispose();
  });

  it("切片之间取消会丢弃整次结果，后续检测仍可使用会话", async () => {
    const { detector, run } = createDetector();
    await detector.load();
    const controller = new AbortController();
    await expect(
      detector.detect(image, {
        smallObjectEnhancement: true,
        signal: controller.signal,
        onProgress: ({ completed }) => {
          if (completed === 2) controller.abort();
        }
      })
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(run).toHaveBeenCalledTimes(2);
    expect((await detector.detect(image)).detections).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(3);
    await detector.dispose();
  });

  it("增强期间 dispose 停止余下切片和排队检测并释放一次", async () => {
    const { detector, run, dispose, disposeResources } = createDetector();
    await detector.load();
    let release: Promise<void> | undefined;
    const operation = detector.detect(image, {
      smallObjectEnhancement: true,
      onProgress: ({ completed }) => {
        if (completed === 1) release = detector.dispose();
      }
    });
    const queued = detector.detect(image);
    await expect(operation).rejects.toMatchObject({ code: "DISPOSED" });
    await expect(queued).rejects.toMatchObject({ code: "DISPOSED" });
    await release;
    expect(run).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(disposeResources).toHaveBeenCalledTimes(1);
  });

  it("极小图片不重复执行与整图相同的切片", async () => {
    const { detector, run } = createDetector();
    await detector.load();
    const result = await detector.detect(
      { width: 1, height: 1, rgba: new Uint8ClampedArray(4) },
      { smallObjectEnhancement: true }
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.smallObjectEnhancement).toEqual({ passes: 1 });
    await detector.dispose();
  });

  it("增强拒绝超出像素上限的输入且不分配 Canvas 或开始推理", async () => {
    const { detector, run } = createDetector();
    await detector.load();
    await expect(
      detector.detect({ width: 8192, height: 8192 } as HTMLCanvasElement, {
        smallObjectEnhancement: true
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", details: { maxPixels: 16777216 } });
    expect(run).not.toHaveBeenCalled();
    await detector.dispose();
  });

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
