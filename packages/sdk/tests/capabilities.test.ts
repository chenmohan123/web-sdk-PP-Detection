import { expect, it } from "vitest";
import { probePPDetectionCapabilities } from "../src/index";
import { probeCapabilities } from "../src/runtime/capabilities";

it("能力探测读取真实对象而不依赖 User-Agent", () => {
  const fakeGlobal = {
    navigator: { gpu: {} },
    Worker: class Worker {},
    OffscreenCanvas: class OffscreenCanvas {}
  } as unknown as typeof globalThis;
  const result = probeCapabilities({ global: fakeGlobal });
  expect(result.webgpu).toBe(true);
  expect(result.worker).toBe(true);
  expect(result.offscreenCanvas).toBe(true);
});

it("公开导出 PPDetection 专属能力探测函数", () => {
  const fakeGlobal = {
    navigator: { gpu: {} },
    Worker: class Worker {},
    OffscreenCanvas: class OffscreenCanvas {}
  } as unknown as typeof globalThis;

  expect(probePPDetectionCapabilities({ global: fakeGlobal })).toEqual({
    webgpu: true,
    worker: true,
    offscreenCanvas: true,
    wasmSimd: false,
    wasmThreads: false
  });
});
