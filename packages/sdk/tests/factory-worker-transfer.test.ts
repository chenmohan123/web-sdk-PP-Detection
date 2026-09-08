import { afterEach, expect, it, vi } from "vitest";
import { createPPDetection } from "../src";
import type { RuntimeDetectionManifest } from "../src";
import type { WorkerRequest, WorkerResponse } from "../src/runtime/protocol";

afterEach(() => vi.unstubAllGlobals());

it("Worker GPU 推理失败后，CPU 回退收到完整输入且后续检测仍可执行", async () => {
  const received: { backend: string; values: number[] }[] = [];
  class TransferWorker {
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    backend = "";
    postMessage(message: WorkerRequest, transfer: Transferable[]) {
      // 保留实际 WorkerBridge，并用原生转移语义分离发送方缓冲区。
      const request = structuredClone(message, { transfer });
      let response: WorkerResponse = { id: request.id, type: "result", result: {} };
      if (request.type === "load") {
        this.backend = request.plan.actualBackend;
        response = {
          id: request.id,
          type: "result",
          result: { runtimeVersion: "transfer-fixture" }
        };
      }
      if (request.type === "run") {
        const input = request.input as { image: { data: Float32Array } };
        received.push({ backend: this.backend, values: [...input.image.data] });
        response =
          this.backend === "webgpu"
            ? {
                id: request.id,
                type: "error",
                error: { code: "INFERENCE_FAILED", message: "模拟 GPU 推理失败" }
              }
            : {
                id: request.id,
                type: "result",
                result: { dets: { data: new Float32Array([0, 0.9, 0, 0, 2, 2]), dims: [1, 6] } }
              };
      }
      queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>));
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", TransferWorker);
  vi.stubGlobal("navigator", { gpu: {} });
  const sha256 = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";
  const manifest: RuntimeDetectionManifest = {
    schemaVersion: 1,
    model: { id: "transfer-fixture", version: "1.0.0" },
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
        backends: ["webgpu", "wasm"],
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
  const detector = await createPPDetection({
    backend: "auto",
    allowFallback: true,
    executionMode: "worker",
    precision: "fp32",
    cache: false,
    model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest }
  });
  try {
    const raster = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
    const first = await detector.detect(raster as ImageData);
    const second = await detector.detect(raster as ImageData);
    expect(first.detections[0]?.label).toBe("person");
    expect(second.runtime.backend).toBe("wasm");
    expect(first.runtime.fallbacks).toHaveLength(1);
    expect(received.map((item) => item.backend)).toEqual(["webgpu", "wasm", "wasm"]);
    expect(received.map((item) => item.values)).toEqual(
      Array.from({ length: 3 }, () => Array(12).fill(1))
    );
  } finally {
    await detector.dispose();
  }
});
