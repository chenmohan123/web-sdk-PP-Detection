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
});
