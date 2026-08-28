import { afterEach, expect, it, vi } from "vitest";

const outputBuffer = new ArrayBuffer(8);
const { createdSessions, createSession } = vi.hoisted(() => ({
  createdSessions: [] as Array<{
    run: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  createSession: vi.fn()
}));
vi.mock("../src/runtime/ort-session", () => ({
  createOrtSession: createSession.mockImplementation(async () => {
    const session = {
      run: vi.fn(async () => ({ output: new Float32Array(outputBuffer) })),
      dispose: vi.fn()
    };
    createdSessions.push(session);
    return session;
  })
}));

const originalPostMessage = globalThis.postMessage;
const originalOnMessage = globalThis.onmessage;

afterEach(() => {
  globalThis.postMessage = originalPostMessage;
  globalThis.onmessage = originalOnMessage;
  createdSessions.length = 0;
  createSession.mockClear();
  vi.resetModules();
});

it("Worker 将嵌套 TypedArray 输出作为 Transferable 发送", async () => {
  const postMessage = vi.fn();
  globalThis.postMessage = postMessage as typeof globalThis.postMessage;
  await import("../src/runtime/inference.worker");
  const handler = globalThis.onmessage as (event: MessageEvent) => Promise<void>;
  await handler({
    data: {
      id: "load",
      type: "load",
      modelBytes: new ArrayBuffer(1),
      plan: {},
      ort: { wasmPaths: "/ort", numThreads: 4 }
    }
  } as MessageEvent);
  expect(createSession).toHaveBeenCalledWith(
    expect.any(ArrayBuffer),
    {},
    { wasmPaths: "/ort", numThreads: 4 }
  );
  await handler({ data: { id: "run", type: "run", input: {} } } as MessageEvent);
  const outputCall = postMessage.mock.calls.find(
    ([response]) => response.id === "run" && response.type === "result"
  );
  expect(outputCall?.[1]).toEqual([outputBuffer]);
});

it("Worker 重复加载模型时释放旧 Session", async () => {
  globalThis.postMessage = vi.fn() as typeof globalThis.postMessage;
  await import("../src/runtime/inference.worker");
  const handler = globalThis.onmessage as (event: MessageEvent) => Promise<void>;
  await handler({
    data: { id: "first", type: "load", modelBytes: new ArrayBuffer(1), plan: {} }
  } as MessageEvent);
  await handler({
    data: { id: "second", type: "load", modelBytes: new ArrayBuffer(1), plan: {} }
  } as MessageEvent);
  expect(createdSessions).toHaveLength(2);
  expect(createdSessions[0].dispose).toHaveBeenCalledTimes(1);
  expect(createdSessions[1].dispose).not.toHaveBeenCalled();
});
