import { describe, expect, it, vi } from "vitest";
import { WorkerBridge } from "../src/runtime/worker-bridge";
import { transferableValues } from "../src/runtime/protocol";

class FakeWorker {
  readonly messages: Array<{ message: unknown; transfer: Transferable[] }> = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: unknown, transfer: Transferable[]) {
    this.messages.push({ message, transfer });
  }
  readonly terminate = vi.fn();
  respond(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

it("Transferable 按底层 ArrayBuffer 去重并忽略 SharedArrayBuffer", () => {
  const buffer = new ArrayBuffer(8);
  const value: Record<string, unknown> = {
    first: new Uint8Array(buffer),
    second: new Float32Array(buffer)
  };
  if (typeof SharedArrayBuffer !== "undefined")
    value.shared = new Uint8Array(new SharedArrayBuffer(4));
  expect(transferableValues(value)).toEqual([buffer]);
});

it("已取消的 run 不会向 Worker 发送消息", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const controller = new AbortController();
  controller.abort();
  await expect(
    bridge.run({ image: new Float32Array([1]) }, { signal: controller.signal })
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect(worker.messages).toHaveLength(0);
});

it("运行中的 run 被取消时通知 Worker 并忽略迟到结果", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const controller = new AbortController();
  const pending = bridge.run({ image: new Float32Array([1]) }, { signal: controller.signal });
  const runRequest = worker.messages[0].message as { id: string };
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  expect(worker.messages.map(({ message }) => (message as { type: string }).type)).toEqual([
    "run",
    "cancel"
  ]);
  worker.respond({ id: runRequest.id, type: "result", result: { ignored: false } });
});

it("WorkerBridge 传递 load 的 ArrayBuffer 并解析 result", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const loaded = bridge.load(new ArrayBuffer(8), { variantId: "fp32" });
  const request = worker.messages[0].message as { id: string; type: string };
  expect(request.type).toBe("load");
  expect(worker.messages[0].transfer).toHaveLength(1);
  worker.respond({ id: request.id, type: "result", result: { ok: true } });
  await expect(loaded).resolves.toEqual({ ok: true });
  const dispose = bridge.dispose();
  const disposeRequest = worker.messages[1].message as { id: string };
  worker.respond({ id: disposeRequest.id, type: "result", result: { disposed: true } });
  await dispose;
});

it("WorkerBridge 将 ORT WASM 配置放入 load 请求而不转移配置对象", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const loaded = bridge.load(
    new ArrayBuffer(8),
    { variantId: "fp32" },
    {
      ort: { wasmPaths: "/ort", numThreads: 4 }
    }
  );
  const request = worker.messages[0].message as { ort?: unknown };
  expect(request.ort).toEqual({ wasmPaths: "/ort", numThreads: 4 });
  worker.respond({
    id: (worker.messages[0].message as { id: string }).id,
    type: "result",
    result: {}
  });
  await loaded;
});

it("WorkerBridge 将请求对应的 progress 透传给调用方", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const onProgress = vi.fn();
  const loaded = bridge.load(new ArrayBuffer(8), { variantId: "fp32" }, { onProgress });
  const request = worker.messages[0].message as { id: string };
  worker.respond({
    id: request.id,
    type: "progress",
    phase: "session",
    status: "start",
    loadedBytes: 8,
    totalBytes: 8
  });
  expect(onProgress).toHaveBeenCalledWith({
    phase: "session",
    status: "start",
    loadedBytes: 8,
    totalBytes: 8
  });
  worker.respond({ id: request.id, type: "result", result: { ok: true } });
  await loaded;
});

it("Worker 错误会拒绝 pending 请求并在 dispose 后拒绝新请求", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const pending = bridge.run({ image: new Float32Array([1, 2]) });
  const request = worker.messages[0].message as { id: string };
  worker.respond({
    id: request.id,
    type: "error",
    error: { code: "INFERENCE_FAILED", message: "bad", details: {} }
  });
  await expect(pending).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
  const dispose = bridge.dispose();
  const disposeRequest = worker.messages[1].message as { id: string };
  worker.respond({ id: disposeRequest.id, type: "result", result: { disposed: true } });
  await dispose;
  await expect(bridge.run({ image: new Float32Array([1]) })).rejects.toMatchObject({
    code: "DISPOSED"
  });
});

it("并发 dispose 只发送一次消息并只终止一次 Worker", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const first = bridge.dispose();
  const second = bridge.dispose();
  expect(worker.messages).toHaveLength(1);
  const request = worker.messages[0].message as { id: string };
  worker.respond({ id: request.id, type: "result", result: { disposed: true } });
  await Promise.all([first, second]);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  await expect(bridge.load(new ArrayBuffer(1), { variantId: "fp32" })).rejects.toMatchObject({
    code: "DISPOSED"
  });
});

it("postMessage 同步失败会拒绝请求", async () => {
  const worker = new FakeWorker();
  worker.postMessage = () => {
    throw new DOMException("detached", "DataCloneError");
  };
  const bridge = new WorkerBridge(worker);
  await expect(bridge.run({ image: new Float32Array([1]) })).rejects.toMatchObject({
    code: "INFERENCE_FAILED"
  });
});

it("Worker 全局错误后拒绝新请求", async () => {
  const worker = new FakeWorker();
  const bridge = new WorkerBridge(worker);
  const pending = bridge.run({ image: new Float32Array([1]) });
  worker.onerror?.({ message: "crashed" } as ErrorEvent);
  await expect(pending).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
  await expect(bridge.run({ image: new Float32Array([2]) })).rejects.toMatchObject({
    code: "DISPOSED"
  });
  expect(worker.messages).toHaveLength(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
