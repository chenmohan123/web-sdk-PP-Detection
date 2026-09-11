import { describe, expect, it } from "vitest";
import { PPDetectionError } from "../src/errors";
import { selectExecutionPlan } from "../src/runtime/select-plan";
import type { DetectionCapabilities, DetectionManifest } from "../src/types";

const manifest: DetectionManifest = {
  id: "pp-picodet-l-320",
  version: "1.0.0",
  variants: [
    {
      id: "fp32",
      precision: "fp32",
      quantization: null,
      backends: ["wasm", "webgpu"],
      status: "stable"
    },
    { id: "fp16", precision: "fp16", quantization: null, backends: ["webgpu"], status: "stable" },
    {
      id: "int8",
      precision: "int8",
      quantization: "static-qdq",
      backends: ["wasm"],
      status: "labs"
    }
  ]
};

const capabilities: DetectionCapabilities = {
  webgpu: true,
  worker: true,
  offscreenCanvas: true,
  wasmSimd: true,
  wasmThreads: true
};

describe("selectExecutionPlan", () => {
  it("显式 webgpu 不可用时抛出能力错误，不静默回退", () => {
    expect(() =>
      selectExecutionPlan({ backend: "webgpu" }, { ...capabilities, webgpu: false }, manifest)
    ).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNSUPPORTED" }));
  });

  it("auto 且允许回退时按 webgpu 到 wasm 选择", () => {
    const plan = selectExecutionPlan(
      { backend: "auto", allowFallback: true },
      capabilities,
      manifest
    );
    expect(plan.candidates.map((candidate) => candidate.backend)).toEqual(["webgpu", "wasm"]);
    expect(plan.actualBackend).toBe("webgpu");
    expect(plan.requestedBackend).toBe("auto");
  });

  it("auto 且不允许回退时选择仅支持 WASM 的模型", () => {
    const wasmOnlyManifest: DetectionManifest = {
      ...manifest,
      variants: [
        {
          id: "fp32",
          precision: "fp32",
          quantization: null,
          backends: ["wasm"],
          status: "stable"
        }
      ]
    };
    const plan = selectExecutionPlan(
      { backend: "auto", allowFallback: false },
      capabilities,
      wasmOnlyManifest
    );
    expect(plan.candidates.map((candidate) => candidate.backend)).toEqual(["wasm"]);
    expect(plan.actualBackend).toBe("wasm");
  });

  it("显式 fp16 不会替换为 fp32", () => {
    expect(() =>
      selectExecutionPlan({ backend: "wasm", precision: "fp16" }, capabilities, manifest)
    ).toThrowError(PPDetectionError);
  });

  it("worker 不可用时拒绝 worker", () => {
    expect(() =>
      selectExecutionPlan({ executionMode: "worker" }, { ...capabilities, worker: false }, manifest)
    ).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNSUPPORTED" }));
  });

  it("没有 stable 证据的 int8 不能作为稳定候选", () => {
    expect(() =>
      selectExecutionPlan({ backend: "wasm", precision: "int8" }, capabilities, manifest)
    ).toThrowError(expect.objectContaining({ code: "MODEL_INCOMPATIBLE" }));
  });

  it("显式允许实验变体时可以选择 labs", () => {
    const plan = selectExecutionPlan(
      { allowExperimental: true, backend: "wasm", precision: "int8" },
      capabilities,
      manifest
    );

    expect(plan.variantId).toBe("int8");
    expect(plan.actualPrecision).toBe("int8");
  });

  it("同精度同时存在 stable 与 labs 时始终优先 stable", () => {
    const mixedManifest: DetectionManifest = {
      ...manifest,
      variants: [
        {
          id: "fp32-labs",
          precision: "fp32",
          quantization: null,
          backends: ["wasm"],
          status: "labs"
        },
        {
          id: "fp32-stable",
          precision: "fp32",
          quantization: null,
          backends: ["wasm"],
          status: "stable"
        }
      ]
    };

    const plan = selectExecutionPlan(
      { allowExperimental: true, backend: "wasm", precision: "fp32" },
      capabilities,
      mixedManifest
    );

    expect(plan.variantId).toBe("fp32-stable");
  });

  it("blocked 变体即使显式允许实验能力也不能选择", () => {
    const blockedManifest: DetectionManifest = {
      ...manifest,
      variants: [
        {
          id: "fp32-blocked",
          precision: "fp32",
          quantization: null,
          backends: ["wasm"],
          status: "blocked"
        }
      ]
    };

    expect(() =>
      selectExecutionPlan(
        { allowExperimental: true, backend: "wasm", precision: "fp32" },
        capabilities,
        blockedManifest
      )
    ).toThrowError(expect.objectContaining({ code: "MODEL_INCOMPATIBLE" }));
  });
});
