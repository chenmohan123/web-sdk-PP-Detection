import { expect, it } from "vitest";
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
