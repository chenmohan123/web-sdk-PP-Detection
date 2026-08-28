import { expect, it, vi } from "vitest";
import type { RuntimeDetectionManifest } from "../src/types";

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(async () => undefined),
  load: vi.fn(async () => ({ loaded: true })),
  run: vi.fn(async () => ({
    dets: { data: new Float32Array([0, 0.8, 0, 0, 2, 2]), dims: [1, 6] }
  }))
}));

vi.mock("../src/runtime/worker-bridge", () => ({
  WorkerBridge: class {
    load = mocks.load;
    run = mocks.run;
    dispose = mocks.dispose;
  }
}));

import { createPPDetection } from "../src";

const sha256 = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";
const manifest: RuntimeDetectionManifest = {
  schemaVersion: 1,
  model: { id: "worker-tiny", version: "1.0.0" },
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
          revision: sha256,
          path: "tiny.onnx",
          downloadUrl: "https://fixture.invalid/tiny.onnx",
          bytes: 4,
          sha256
        }
      ]
    }
  ]
};

it("worker 模式通过 WorkerBridge 加载模型和执行单帧推理", async () => {
  const originalWorker = globalThis.Worker;
  class FakeWorker {}
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  try {
    const modelData = new Uint8Array([1, 2, 3, 4]).buffer;
    const detector = await createPPDetection({
      backend: "wasm",
      cache: false,
      executionMode: "worker",
      model: { data: modelData, manifest },
      precision: "fp32"
    });
    const result = await detector.detect({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16).fill(255)
    } as ImageData);

    expect(mocks.load).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({ actualBackend: "wasm", executionMode: "worker" }),
      expect.objectContaining({
        onProgress: expect.any(Function),
        ort: { wasmPaths: undefined, numThreads: undefined }
      })
    );
    expect(mocks.load.mock.calls[0]?.[0]).not.toBe(modelData);
    expect(modelData.byteLength).toBe(4);
    expect(mocks.run).toHaveBeenCalledWith(
      { image: expect.objectContaining({ data: expect.any(Float32Array), dims: [1, 3, 2, 2] }) },
      expect.objectContaining({ signal: undefined })
    );
    expect(result.runtime.mode).toBe("worker");
    await detector.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: originalWorker });
  }
});

it("Worker 加载失败时释放已创建的 WorkerBridge", async () => {
  const originalWorker = globalThis.Worker;
  class FakeWorker {}
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  mocks.load.mockClear();
  mocks.dispose.mockClear();
  mocks.load.mockRejectedValueOnce(new Error("worker load failed"));
  try {
    await expect(
      createPPDetection({
        backend: "wasm",
        cache: false,
        executionMode: "worker",
        model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest },
        precision: "fp32"
      })
    ).rejects.toMatchObject({ code: "SESSION_CREATE_FAILED" });
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: originalWorker });
  }
});
