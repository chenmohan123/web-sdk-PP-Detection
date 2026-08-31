import { describe, expect, it, vi } from "vitest";
import { createPPDetection } from "../src";
import type { RuntimeDetectionManifest } from "../src/types";

const sha256 = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";

const manifest: RuntimeDetectionManifest = {
  schemaVersion: 1,
  model: { id: "tiny", version: "1.0.0" },
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

describe("createPPDetection", () => {
  it("初始化时报告能力和 manifest 阶段", async () => {
    const events: string[] = [];
    const release = vi.fn();
    const detector = await createPPDetection({
      backend: "wasm",
      cache: false,
      model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest },
      ort: {
        module: {
          env: { wasm: {} },
          InferenceSession: { create: vi.fn(async () => ({ run: vi.fn(), release })) }
        }
      },
      precision: "fp32",
      onProgress: (event) => events.push(`${event.phase}:${event.status}`)
    });
    await detector.dispose();
    expect(events.slice(0, 4)).toEqual([
      "capabilities:complete",
      "manifest:start",
      "manifest:complete",
      "model:start"
    ]);
  });

  it("manifest URL 的 AbortError 映射为 ABORTED", async () => {
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"))
    });
    try {
      await expect(
        createPPDetection({ model: "https://fixture.invalid/manifest.json" })
      ).rejects.toMatchObject({
        code: "ABORTED"
      });
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    }
  });

  it("内存模型按显式 source 选择来源进行完整性校验", async () => {
    const release = vi.fn();
    const create = vi.fn(async () => ({ run: vi.fn(), release }));
    const selectedSourceManifest = {
      ...manifest,
      variants: [
        {
          ...manifest.variants[0],
          sources: [
            {
              ...manifest.variants[0].sources[0],
              sha256: "0".repeat(64),
              revision: "0".repeat(64)
            },
            {
              ...manifest.variants[0].sources[0],
              kind: "modelscope" as const,
              sha256,
              revision: sha256
            }
          ]
        }
      ]
    };
    const detector = await createPPDetection({
      backend: "wasm",
      cache: false,
      source: "modelscope",
      model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest: selectedSourceManifest },
      ort: { module: { env: { wasm: {} }, InferenceSession: { create } } },
      precision: "fp32"
    });
    await detector.dispose();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("内存模型经完整性校验和 ORT Session 加载后可直接检测", async () => {
    const release = vi.fn();
    const run = vi.fn(async () => ({
      dets: { data: new Float32Array([0, 0.9, 0, 0, 2, 2]), dims: [1, 6] }
    }));
    const create = vi.fn(async () => ({ run, release }));
    class Tensor {
      constructor(
        readonly type: string,
        readonly data: Float32Array,
        readonly dims: readonly number[]
      ) {}
    }

    const detector = await createPPDetection({
      backend: "wasm",
      cache: false,
      model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest },
      ort: { module: { env: { wasm: {} }, InferenceSession: { create }, Tensor } },
      precision: "fp32"
    });
    const result = await detector.detect({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16).fill(255)
    } as ImageData);

    expect(create).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      executionProviders: ["wasm"]
    });
    expect(run).toHaveBeenCalledWith(
      { image: expect.objectContaining({ type: "float32", dims: [1, 3, 2, 2] }) },
      { terminate: false }
    );
    expect(result.detections[0]?.label).toBe("person");
    expect(result.detections[0]?.score).toBeCloseTo(0.9);
    expect(result.model).toMatchObject({ id: "tiny", bytes: 4, parameterCount: 1, opset: 11 });
    expect(result.runtime).toMatchObject({ backend: "wasm", precision: "fp32", mode: "main" });
    expect(detector.loadTimings.totalMs).toBeGreaterThanOrEqual(0);

    await detector.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("模型 bytes 与 SHA-256 不一致时不创建 Session", async () => {
    const create = vi.fn();
    await expect(
      createPPDetection({
        backend: "wasm",
        model: { data: new Uint8Array([4, 3, 2, 1]).buffer, manifest },
        ort: { module: { env: { wasm: {} }, InferenceSession: { create } } },
        precision: "fp32"
      })
    ).rejects.toMatchObject({ code: "MODEL_INTEGRITY_FAILED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("auto 允许回退时在 webgpu Session 失败后尝试 wasm 并记录原因", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} }
    });
    const fallbackManifest: RuntimeDetectionManifest = {
      ...manifest,
      variants: [{ ...manifest.variants[0], backends: ["webgpu", "wasm"] }]
    };
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("webgpu provider failed"))
      .mockResolvedValue({
        run: vi.fn(async () => ({ dets: { data: new Float32Array(), dims: [0, 6] } })),
        release: vi.fn()
      });
    try {
      const detector = await createPPDetection({
        allowFallback: true,
        backend: "auto",
        cache: false,
        model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest: fallbackManifest },
        ort: { module: { env: { wasm: {} }, InferenceSession: { create } } },
        precision: "fp32"
      });

      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls.map((call) => call[1].executionProviders)).toEqual([
        ["webgpu"],
        ["wasm"]
      ]);
      expect(detector.runtime.backend).toBe("wasm");
      expect(detector.runtime.fallbacks).toHaveLength(1);
      expect(detector.runtime.fallbacks[0]).toMatchObject({
        code: "SESSION_CREATE_FAILED",
        provider: "webgpu",
        stage: "session"
      });
      await detector.dispose();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator
      });
    }
  });

  it("auto 在 WebGPU 推理失败后回退到 WASM 并记录推理阶段原因", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} }
    });
    const fallbackManifest: RuntimeDetectionManifest = {
      ...manifest,
      variants: [{ ...manifest.variants[0], backends: ["webgpu", "wasm"] }]
    };
    const webgpuRun = vi.fn().mockRejectedValue(new Error("webgpu kernel failed"));
    const wasmRun = vi.fn(async () => ({
      dets: { data: new Float32Array([0, 0.9, 0, 0, 2, 2]), dims: [1, 6] }
    }));
    const create = vi
      .fn()
      .mockResolvedValueOnce({ run: webgpuRun, release: vi.fn() })
      .mockResolvedValueOnce({ run: wasmRun, release: vi.fn() });
    try {
      const detector = await createPPDetection({
        allowFallback: true,
        backend: "auto",
        cache: false,
        model: { data: new Uint8Array([1, 2, 3, 4]).buffer, manifest: fallbackManifest },
        ort: { module: { env: { wasm: {} }, InferenceSession: { create } } },
        precision: "fp32"
      });

      const result = await detector.detect({
        width: 2,
        height: 2,
        data: new Uint8ClampedArray(16).fill(255)
      } as ImageData);

      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls.map((call) => call[1].executionProviders)).toEqual([
        ["webgpu"],
        ["wasm"]
      ]);
      expect(webgpuRun).toHaveBeenCalledTimes(1);
      expect(wasmRun).toHaveBeenCalledTimes(1);
      expect(result.runtime.backend).toBe("wasm");
      expect(result.runtime.fallbacks).toHaveLength(1);
      expect(result.runtime.fallbacks[0]).toMatchObject({
        code: "INFERENCE_FAILED",
        provider: "webgpu",
        stage: "inference"
      });
      expect(result.detections[0]?.label).toBe("person");
      await detector.dispose();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator
      });
    }
  });
});
