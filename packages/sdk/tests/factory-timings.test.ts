import { afterEach, describe, expect, it, vi } from "vitest";
import { createPPDetection } from "../src";
import type { PPDetectionDetector, RuntimeDetectionManifest } from "../src";

const bytes = new Uint8Array([1, 2, 3, 4]);
const sha256 = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";
const manifest: RuntimeDetectionManifest = {
  schemaVersion: 1,
  model: { id: "timing-fixture", version: "1.0.0" },
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
const raster = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
const instances: PPDetectionDetector[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((detector) => detector.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function controlledRuntime() {
  let elapsed = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
    const value = await digest(algorithm, data);
    elapsed += 11;
    return value;
  });
  return {
    advance(ms: number) {
      elapsed += ms;
    },
    module: {
      env: { wasm: {}, versions: { web: "9.8.7-fixture" } },
      InferenceSession: {
        async create() {
          elapsed += 30;
          return {
            async run() {
              elapsed += 5;
              return { dets: { data: new Float32Array([0, 0.9, 0, 0, 2, 2]), dims: [1, 6] } };
            },
            release() {}
          };
        }
      }
    }
  };
}

describe("初始化和实际运行信息", () => {
  it("初始化墙钟包含能力探测、清单、下载、校验和会话，检测只记本次运行", async () => {
    const runtime = controlledRuntime();
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      if (String(input).endsWith("manifest.json")) {
        runtime.advance(120);
        return Response.json(manifest);
      }
      runtime.advance(20);
      return new Response(bytes);
    });
    const detector = await createPPDetection({
      model: "https://fixture.invalid/manifest.json",
      backend: "wasm",
      cache: false,
      ort: { module: runtime.module },
      onProgress(event) {
        if (event.phase === "capabilities") runtime.advance(7);
      }
    });
    instances.push(detector);
    expect(detector.loadTimings.totalMs).toBe(188);
    expect(detector.loadTimings.integrityMs).toBe(11);
    expect(detector.loadTimings.sessionMs).toBe(30);
    expect(detector.loadTimings.modelSource).toBe("network");
    const result = await detector.detect(raster);
    expect(result.timings.totalMs).toBe(5);
    expect(result.timings.inferenceMs).toBe(5);
  });

  it("内存模型真实统计校验耗时，并标明来源", async () => {
    const runtime = controlledRuntime();
    const detector = await createPPDetection({
      model: { data: bytes.buffer.slice(0), manifest },
      backend: "wasm",
      cache: false,
      ort: { module: runtime.module }
    });
    instances.push(detector);
    expect(detector.loadTimings.integrityMs).toBe(11);
    expect(detector.loadTimings.totalMs).toBe(41);
    expect(detector.loadTimings.modelSource).toBe("memory");
  });

  it("检测结果使用已加载 ORT 的版本及环境，不猜测自定义运行时版本", async () => {
    const runtime = controlledRuntime();
    vi.stubGlobal("navigator", { userAgent: "Fixture Browser", platform: "Fixture OS" });
    const detector = await createPPDetection({
      model: { data: bytes.buffer.slice(0), manifest },
      backend: "wasm",
      cache: false,
      ort: { module: runtime.module }
    });
    instances.push(detector);
    const result = await detector.detect(raster);
    expect(result.runtime.runtimeVersion).toBe("9.8.7-fixture");
    expect(result.runtime.environment).toMatchObject({
      userAgent: "Fixture Browser",
      platform: "Fixture OS"
    });
    const unknown = await createPPDetection({
      model: { data: bytes.buffer.slice(0), manifest },
      backend: "wasm",
      cache: false,
      ort: { module: { ...runtime.module, env: { wasm: {} } } }
    });
    instances.push(unknown);
    expect(unknown.runtime.runtimeVersion).toBeNull();
  });

  it("初始化累计失败候选的会话耗时，后续回退不改写已返回的结果", async () => {
    const runtime = controlledRuntime();
    vi.stubGlobal("navigator", { gpu: {} });
    let created = 0;
    let runCount = 0;
    const create = async () => {
      const candidate = ++created;
      runtime.advance(candidate === 1 ? 40 : 30);
      return {
        async run() {
          if (candidate === 1 && ++runCount === 2) throw new Error("GPU kernel failed");
          return { dets: { data: new Float32Array([0, 0.9, 0, 0, 2, 2]), dims: [1, 6] } };
        },
        release() {}
      };
    };
    const detector = await createPPDetection({
      model: {
        data: bytes.buffer.slice(0),
        manifest: {
          ...manifest,
          variants: [{ ...manifest.variants[0], backends: ["webgpu", "wasm"] }]
        }
      },
      backend: "auto",
      allowFallback: true,
      cache: false,
      ort: { module: { ...runtime.module, InferenceSession: { create } } }
    });
    instances.push(detector);
    const first = await detector.detect(raster);
    const second = await detector.detect(raster);
    expect(second.runtime.backend).toBe("wasm");
    expect(first.runtime.backend).toBe("webgpu");
    expect(first.runtime.fallbacks).toHaveLength(0);
    expect(detector.loadTimings.sessionMs).toBe(40);

    let attempted = false;
    const retry = await createPPDetection({
      model: {
        data: bytes.buffer.slice(0),
        manifest: {
          ...manifest,
          variants: [{ ...manifest.variants[0], backends: ["webgpu", "wasm"] }]
        }
      },
      backend: "auto",
      allowFallback: true,
      cache: false,
      ort: {
        module: {
          ...runtime.module,
          InferenceSession: {
            async create() {
              if (!attempted) {
                attempted = true;
                runtime.advance(50);
                throw new Error("GPU unavailable");
              }
              return create();
            }
          }
        }
      }
    });
    instances.push(retry);
    expect(retry.loadTimings.sessionMs).toBe(80);
  });
});
