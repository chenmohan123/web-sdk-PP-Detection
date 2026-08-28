import type { ExecutionPlan } from "./select-plan";

export interface WorkerOrtOptions {
  readonly wasmPaths?: string;
  readonly numThreads?: number;
}

export type WorkerRequest =
  | {
      readonly id: string;
      readonly type: "load";
      readonly modelBytes: ArrayBuffer;
      readonly plan: ExecutionPlan;
      readonly ort?: WorkerOrtOptions;
    }
  | { readonly id: string; readonly type: "run"; readonly input: unknown }
  | { readonly id: string; readonly type: "cancel"; readonly requestId: string }
  | { readonly id: string; readonly type: "dispose" };

export type WorkerResponse =
  | {
      readonly id: string;
      readonly type: "progress";
      readonly phase: string;
      readonly status: string;
      readonly loadedBytes?: number;
      readonly totalBytes?: number;
    }
  | { readonly id: string; readonly type: "result"; readonly result: unknown }
  | {
      readonly id: string;
      readonly type: "error";
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details?: Record<string, unknown>;
      };
    };

export function transferableValues(value: unknown): Transferable[] {
  const transferables = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (candidate instanceof ArrayBuffer) {
      transferables.add(candidate);
      return;
    }
    if (ArrayBuffer.isView(candidate)) {
      if (candidate.buffer instanceof ArrayBuffer) transferables.add(candidate.buffer);
      return;
    }
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
  return [...transferables];
}
