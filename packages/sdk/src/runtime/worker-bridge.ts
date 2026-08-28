import { PPDetectionError } from "../errors";
import type { PPDetectionErrorCode } from "../errors";
import type { ExecutionPlan } from "./select-plan";
import { transferableValues, type WorkerOrtOptions, type WorkerResponse } from "./protocol";

interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly cleanup: () => void;
  readonly onProgress?: (progress: WorkerProgress) => void;
}

export interface WorkerProgress {
  readonly phase: string;
  readonly status: string;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
}

export interface WorkerRequestOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: WorkerProgress) => void;
}

export interface WorkerLoadOptions {
  readonly onProgress?: (progress: WorkerProgress) => void;
  readonly ort?: WorkerOrtOptions;
}

export class WorkerBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private state: "active" | "disposing" | "disposed" = "active";
  private disposePromise?: Promise<void>;
  private terminated = false;
  private sequence = 0;

  constructor(private readonly worker: WorkerLike) {
    worker.onmessage = (event) => this.handleResponse(event.data);
    worker.onerror = (event) =>
      this.shutdown(
        new PPDetectionError("INFERENCE_FAILED", event.message || "Worker 执行失败", {
          source: "worker"
        })
      );
  }

  load(
    modelBytes: ArrayBuffer,
    plan: ExecutionPlan,
    options: WorkerLoadOptions = {}
  ): Promise<unknown> {
    return this.request(
      { type: "load", modelBytes, plan, ...(options.ort ? { ort: options.ort } : {}) },
      [modelBytes],
      options
    );
  }

  run(input: unknown, options: WorkerRequestOptions = {}): Promise<unknown> {
    return this.request({ type: "run", input }, transferableValues(input), {
      signal: options.signal,
      onProgress: options.onProgress
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    if (this.state === "disposed") return Promise.resolve();
    this.state = "disposing";
    this.disposePromise = this.request({ type: "dispose" }, [], { allowDuringDispose: true })
      .then(() => undefined)
      .finally(() => this.shutdown(new PPDetectionError("DISPOSED", "Worker 已释放")));
    return this.disposePromise;
  }

  private request(
    payload: Record<string, unknown>,
    transfer: Transferable[],
    options: WorkerRequestOptions & { readonly allowDuringDispose?: boolean } = {}
  ): Promise<unknown> {
    if (this.state !== "active" && !(options.allowDuringDispose && this.state === "disposing")) {
      return Promise.reject(new PPDetectionError("DISPOSED", "Worker 已释放"));
    }
    if (options.signal?.aborted)
      return Promise.reject(new PPDetectionError("ABORTED", "Worker 推理已取消"));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      let posted = false;
      const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        cleanup();
        if (posted && payload.type === "run") this.sendCancel(id);
        reject(new PPDetectionError("ABORTED", "Worker 推理已取消"));
      };
      this.pending.set(id, { resolve, reject, cleanup, onProgress: options.onProgress });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        this.worker.postMessage({ id, ...payload }, transfer);
        posted = true;
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        reject(
          new PPDetectionError(
            "INFERENCE_FAILED",
            "向 Worker 发送消息失败",
            { requestType: payload.type },
            { cause: error }
          )
        );
      }
    });
  }

  private sendCancel(requestId: string): void {
    try {
      this.worker.postMessage({ id: String(++this.sequence), type: "cancel", requestId }, []);
    } catch {
      // 原请求已在调用方取消；失效 Worker 将由 onerror 或 dispose 收敛。
    }
  }

  private handleResponse(response: WorkerResponse): void {
    if (response.type === "progress") {
      this.pending.get(response.id)?.onProgress?.({
        phase: response.phase,
        status: response.status,
        ...(response.loadedBytes === undefined ? {} : { loadedBytes: response.loadedBytes }),
        ...(response.totalBytes === undefined ? {} : { totalBytes: response.totalBytes })
      });
      return;
    }
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    request.cleanup();
    if (response.type === "result") request.resolve(response.result);
    else
      request.reject(
        new PPDetectionError(
          response.error.code as PPDetectionErrorCode,
          response.error.message,
          response.error.details ?? {}
        )
      );
  }

  private failAll(error: PPDetectionError): void {
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
  }

  private shutdown(error: PPDetectionError): void {
    this.state = "disposed";
    if (!this.terminated) {
      this.terminated = true;
      this.worker.terminate();
    }
    this.failAll(error);
  }
}
