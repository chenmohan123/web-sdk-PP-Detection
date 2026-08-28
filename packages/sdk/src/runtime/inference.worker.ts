import { PPDetectionError } from "../errors";
import { createOrtSession, type OrtSessionHandle } from "./ort-session";
import { transferableValues, type WorkerRequest, type WorkerResponse } from "./protocol";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let session: OrtSessionHandle | undefined;
const running = new Map<string, AbortController>();

export const runtimeWorkerEntrypoint = "runtime";

function serializeOutputs(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }
  if ("data" in value && "dims" in value) {
    const tensor = value as { data?: unknown; dims?: unknown };
    if (ArrayBuffer.isView(tensor.data) && Array.isArray(tensor.dims)) {
      return { data: tensor.data, dims: tensor.dims };
    }
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return Object.fromEntries(entries.map(([name, child]) => [name, serializeOutputs(child)]));
}

function send(response: WorkerResponse): void {
  const transfer = response.type === "result" ? transferableValues(response.result) : [];
  workerScope.postMessage(response, transfer);
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "cancel") {
      running.get(request.requestId)?.abort();
      return;
    }
    if (request.type === "load") {
      send({
        id: request.id,
        type: "progress",
        phase: "session",
        status: "start",
        loadedBytes: request.modelBytes.byteLength,
        totalBytes: request.modelBytes.byteLength
      });
      const nextSession = await createOrtSession(request.modelBytes, request.plan, {
        wasmPaths: request.ort?.wasmPaths,
        numThreads: request.ort?.numThreads
      });
      const previousSession = session;
      session = nextSession;
      await previousSession?.dispose();
      send({ id: request.id, type: "result", result: { loaded: true } });
      return;
    }
    if (request.type === "run") {
      if (!session) throw new PPDetectionError("SESSION_CREATE_FAILED", "Worker 会话尚未加载");
      send({ id: request.id, type: "progress", phase: "inference", status: "start" });
      const controller = new AbortController();
      running.set(request.id, controller);
      try {
        const result = await session.run(request.input as Record<string, unknown>, {
          signal: controller.signal
        });
        send({ id: request.id, type: "result", result: serializeOutputs(result) });
      } finally {
        running.delete(request.id);
      }
      return;
    }
    for (const controller of running.values()) controller.abort();
    running.clear();
    await session?.dispose();
    session = undefined;
    send({ id: request.id, type: "result", result: { disposed: true } });
  } catch (error) {
    const mapped =
      error instanceof PPDetectionError
        ? error
        : new PPDetectionError("INFERENCE_FAILED", String(error));
    send({
      id: request.id,
      type: "error",
      error: { code: mapped.code, message: mapped.message, details: mapped.details }
    });
  }
};
