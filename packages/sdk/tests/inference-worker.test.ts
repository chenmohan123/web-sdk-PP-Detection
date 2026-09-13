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
      runtimeVersion: "9.8.7-worker",
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
  expect(
    postMessage.mock.calls.find(
      ([response]) => response.id === "load" && response.type === "result"
    )?.[0].result
  ).toMatchObject({ loaded: true, runtimeVersion: "9.8.7-worker" });
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

it("Worker 取消后立即重试会等待原推理结束，不重入底层会话", async () => {
  const postMessage = vi.fn();
  globalThis.postMessage = postMessage as typeof globalThis.postMessage;
  await import("../src/runtime/inference.worker");
  const handler = globalThis.onmessage as (event: MessageEvent) => Promise<void>;
  const dispatch = (data: unknown) => handler({ data } as MessageEvent);
  await dispatch({ id: "load", type: "load", modelBytes: new ArrayBuffer(1), plan: {} });
  let finish!: () => void;
  const firstFinished = new Promise<void>((resolve) => (finish = resolve));
  let active = false;
  const entries: string[] = [];
  createdSessions[0].run.mockImplementation(async (input, options) => {
    if (active) throw new Error("底层会话不能重入");
    entries.push(input.name);
    active = true;
    try {
      if (input.name === "first") await firstFinished;
      if (options.signal.aborted) throw new Error("已取消的底层任务收敛");
      return { name: input.name };
    } finally {
      active = false;
    }
  });
  const first = dispatch({ id: "first", type: "run", input: { name: "first" } });
  await vi.waitFor(() => expect(entries).toEqual(["first"]));
  await dispatch({ id: "cancel", type: "cancel", requestId: "first" });
  const second = dispatch({ id: "second", type: "run", input: { name: "second" } });
  // 让第二条消息有机会执行；原推理仍由测试控制保持未完成。
  await new Promise((resolve) => setTimeout(resolve, 0));
  finish();
  await Promise.all([first, second]);
  expect(entries).toEqual(["first", "second"]);
  expect(
    postMessage.mock.calls.find(([r]) => r.id === "second" && r.type === "result")?.[0].result
  ).toEqual({ name: "second" });
});

it("Worker 释放时等待在途任务，并取消尚未启动的排队任务", async () => {
  const postMessage = vi.fn();
  globalThis.postMessage = postMessage as typeof globalThis.postMessage;
  await import("../src/runtime/inference.worker");
  const handler = globalThis.onmessage as (event: MessageEvent) => Promise<void>;
  const dispatch = (data: unknown) => handler({ data } as MessageEvent);
  await dispatch({ id: "load", type: "load", modelBytes: new ArrayBuffer(1), plan: {} });
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => (finish = resolve));
  const entries: string[] = [];
  createdSessions[0].run.mockImplementation(async (input) => {
    entries.push(input.name);
    await waiting;
    return { name: input.name };
  });
  const first = dispatch({ id: "first", type: "run", input: { name: "first" } });
  await vi.waitFor(() => expect(entries).toEqual(["first"]));
  const second = dispatch({ id: "second", type: "run", input: { name: "second" } });
  const disposal = dispatch({ id: "dispose", type: "dispose" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const releasedEarly = createdSessions[0].dispose.mock.calls.length;
  finish();
  await Promise.all([first, second, disposal]);
  expect(releasedEarly).toBe(0);
  expect(entries).toEqual(["first"]);
  expect(createdSessions[0].dispose).toHaveBeenCalledTimes(1);
  expect(
    postMessage.mock.calls.find(([r]) => r.id === "second" && r.type === "error")?.[0].error.code
  ).toBe("ABORTED");
});
