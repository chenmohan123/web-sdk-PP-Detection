import type { DetectionCapabilities } from "../types";

const WASM_SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
  0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0f, 0x00, 0x00, 0x00, 0x0b
]);

function hasWasmSimd(scope: typeof globalThis): boolean {
  try {
    return typeof scope.WebAssembly !== "undefined" && scope.WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    return false;
  }
}

function hasWasmThreads(scope: typeof globalThis): boolean {
  try {
    return (
      typeof scope.SharedArrayBuffer !== "undefined" &&
      typeof scope.Atomics !== "undefined" &&
      scope.crossOriginIsolated === true
    );
  } catch {
    return false;
  }
}

export interface CapabilityProbeOptions {
  readonly global?: typeof globalThis;
}

export function probeCapabilities(options: CapabilityProbeOptions = {}): DetectionCapabilities {
  const scope = options.global ?? globalThis;
  const navigatorValue = scope.navigator;
  return {
    webgpu: Boolean(navigatorValue && "gpu" in navigatorValue && navigatorValue.gpu),
    worker: typeof scope.Worker === "function",
    offscreenCanvas: typeof scope.OffscreenCanvas === "function",
    wasmSimd: hasWasmSimd(scope),
    wasmThreads: hasWasmThreads(scope)
  };
}
