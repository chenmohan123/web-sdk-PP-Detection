import { expect, test } from "playwright/test";
import type { ModelManifest } from "web-sdk-pp-detection";
import {
  allowFallbackForSelection,
  precisionForBackend,
  precisionLabel,
  supportsCombination
} from "../src/execution-preferences";
import { tinyModelManifest } from "../src/fixture";

const fp32 = tinyModelManifest.variants[1];
const fp16 = tinyModelManifest.variants[0];
const w8a32 = {
  ...fp32,
  id: "w8a32",
  precision: "int8" as const,
  quantization: "weight-only-int8-activation-fp32"
};

function manifest(variants: ModelManifest["variants"]): ModelManifest {
  return { ...tinyModelManifest, variants };
}

test("W8A32 的可选后端由当前清单决定", () => {
  const selected = manifest([fp32, { ...w8a32, backendCompatibility: ["webgpu"] }]);
  expect(supportsCombination("webgpu", "int8", selected)).toBe(true);
  expect(supportsCombination("wasm", "int8", selected)).toBe(false);
  expect(precisionForBackend("auto", "int8", selected)).toBe("int8");
  expect(allowFallbackForSelection("auto", "int8")).toBe(true);
  expect(allowFallbackForSelection("webgpu", "int8")).toBe(false);
});

test("切换后端后仍可选择该后端唯一支持的 W8A32 变体", () => {
  expect(precisionForBackend("wasm", "fp16", manifest([w8a32]))).toBe("int8");
});

test("失效的精度选择优先恢复 FP32，不擅自优先 FP16", () => {
  expect(precisionForBackend("wasm", "int8", manifest([fp16, fp32]))).toBe("fp32");
});

test("自动精度保持 SDK 默认行为，不受变体数组顺序影响", () => {
  for (const backend of ["auto", "wasm", "webgpu"] as const) {
    expect(precisionForBackend(backend, "auto", manifest([fp16, w8a32, fp32]))).toBe("auto");
  }
});

test("未通过验证的 W8A32 不作为可选组合", () => {
  const selected = manifest([
    fp32,
    { ...w8a32, validation: { included: true, pass: false, report: "未通过验证" } }
  ]);
  expect(supportsCombination("wasm", "int8", selected)).toBe(false);
  expect(precisionForBackend("wasm", "int8", selected)).toBe("fp32");
});

test("W8A32 标签需要匹配实际变体及其量化声明", () => {
  const selected = manifest([{ ...w8a32, id: "static-int8", quantization: "static-qdq" }, w8a32]);
  expect(precisionLabel("int8", selected, "w8a32")).toBe("W8A32");
  expect(precisionLabel("int8", selected, "static-int8")).toBe("INT8");
  expect(precisionLabel("int8", selected, "missing-variant")).toBe("INT8");
  expect(precisionLabel("fp32", selected, "w8a32")).toBe("fp32");
});
