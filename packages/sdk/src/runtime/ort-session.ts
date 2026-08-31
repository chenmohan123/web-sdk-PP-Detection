import { PPDetectionError } from "../errors";
import type { Backend } from "../types";
import type { ExecutionPlan } from "./select-plan";

export interface OrtInferenceSession {
  run(feeds: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  release?(): Promise<void> | void;
}

export interface OrtModule {
  readonly env: { readonly wasm?: Record<string, unknown> };
  readonly InferenceSession: {
    create(model: ArrayBuffer, options: Record<string, unknown>): Promise<OrtInferenceSession>;
  };
  readonly Tensor?: new (type: string, data: unknown, dims: readonly number[]) => unknown;
}

export interface OrtSessionHandle {
  readonly plan: ExecutionPlan;
  readonly sessionMs: number;
  run(
    feeds: Record<string, unknown>,
    options?: { readonly signal?: AbortSignal }
  ): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface CreateOrtSessionOptions {
  readonly ort?: OrtModule;
  readonly loadOrt?: () => Promise<OrtModule>;
  readonly wasmPaths?: string;
  readonly numThreads?: number;
  readonly sessionOptions?: Readonly<Record<string, unknown>>;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function mapError(error: unknown, phase: "create" | "run"): PPDetectionError {
  if (error instanceof PPDetectionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const details = { phase, causeMessage: message };
  if (/abort|cancel/i.test(message))
    return new PPDetectionError("ABORTED", "推理已取消", details, { cause: error });
  if (/memory|out.of.memory|allocation/i.test(message))
    return new PPDetectionError("OUT_OF_MEMORY", "运行时内存不足", details, { cause: error });
  return new PPDetectionError(
    phase === "create" ? "SESSION_CREATE_FAILED" : "INFERENCE_FAILED",
    phase === "create" ? "创建 ONNX Runtime 会话失败" : "ONNX Runtime 推理失败",
    details,
    { cause: error }
  );
}

function normalizeFeeds(feeds: Record<string, unknown>, ort: OrtModule): Record<string, unknown> {
  const Tensor = ort.Tensor;
  if (!Tensor) return feeds;
  return Object.fromEntries(
    Object.entries(feeds).map(([name, value]) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "data" in value &&
        "dims" in value &&
        (value as { data?: unknown }).data instanceof Float32Array
      ) {
        const input = value as { data: Float32Array; dims: readonly number[] };
        return [name, new Tensor("float32", input.data, input.dims)];
      }
      return [name, value];
    })
  );
}

async function loadOrt(backend: Backend): Promise<OrtModule> {
  return (await (backend === "webgpu"
    ? import("onnxruntime-web/webgpu")
    : import("onnxruntime-web"))) as unknown as OrtModule;
}

export async function createOrtSession(
  modelBytes: ArrayBuffer,
  plan: ExecutionPlan,
  options: CreateOrtSessionOptions = {}
): Promise<OrtSessionHandle> {
  try {
    const ort = options.ort ?? (await (options.loadOrt ?? loadOrt)(plan.actualBackend));
    if (options.wasmPaths && ort.env.wasm) ort.env.wasm.wasmPaths = options.wasmPaths;
    if (plan.actualBackend === "wasm" && ort.env.wasm && options.numThreads)
      ort.env.wasm.numThreads = options.numThreads;
    const sessionStarted = now();
    const session = await ort.InferenceSession.create(modelBytes, {
      ...options.sessionOptions,
      executionProviders: [plan.actualBackend]
    });
    const sessionMs = now() - sessionStarted;
    let disposed = false;
    let disposePromise: Promise<void> | undefined;
    const activeRuns = new Set<Promise<void>>();
    return {
      plan,
      sessionMs,
      async run(feeds, runOptions = {}) {
        if (disposed) throw new PPDetectionError("DISPOSED", "会话已释放", { phase: "run" });
        if (runOptions.signal?.aborted)
          throw new PPDetectionError("ABORTED", "推理已取消", { phase: "run" });
        const ortRunOptions: Record<string, unknown> = {};
        if (plan.actualBackend === "wasm") ortRunOptions.terminate = false;
        let cancelled = false;
        const onAbort = () => {
          cancelled = true;
        };
        runOptions.signal?.addEventListener("abort", onAbort, { once: true });
        const operation = (async () => {
          try {
            const result = await Promise.resolve(
              session.run(normalizeFeeds(feeds, ort), ortRunOptions)
            );
            if (cancelled) throw new PPDetectionError("ABORTED", "推理已取消", { phase: "run" });
            return result;
          } catch (error) {
            if (cancelled)
              throw new PPDetectionError(
                "ABORTED",
                "推理已取消",
                { phase: "run" },
                { cause: error }
              );
            throw mapError(error, "run");
          } finally {
            runOptions.signal?.removeEventListener("abort", onAbort);
          }
        })();
        const tracked = operation.then(
          () => undefined,
          () => undefined
        );
        activeRuns.add(tracked);
        try {
          return await operation;
        } finally {
          activeRuns.delete(tracked);
        }
      },
      async dispose() {
        if (disposePromise) return await disposePromise;
        disposed = true;
        disposePromise = (async () => {
          await Promise.all([...activeRuns]);
          await session.release?.();
        })();
        await disposePromise;
      }
    };
  } catch (error) {
    throw mapError(error, "create");
  }
}
