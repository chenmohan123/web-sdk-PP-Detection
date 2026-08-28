import { describe, expect, it, vi } from "vitest";
import { PPDetectionError } from "../src/errors";
import { createOrtSession } from "../src/runtime/ort-session";
import type { ExecutionPlan } from "../src/runtime/select-plan";

const plan: ExecutionPlan = {
  variantId: "fp32",
  requestedBackend: "wasm",
  actualBackend: "wasm",
  requestedPrecision: "fp32",
  actualPrecision: "fp32",
  executionMode: "main",
  candidates: [{ variantId: "fp32", backend: "wasm", precision: "fp32", executionMode: "main" }]
};

it("按计划创建 wasm session，设置运行时/会话选项并记录耗时", async () => {
  const run = vi.fn().mockResolvedValue({ output: 1 });
  const release = vi.fn();
  const ort = {
    env: { wasm: {} as Record<string, unknown> },
    InferenceSession: { create: vi.fn().mockResolvedValue({ run, release }) }
  };
  const handle = await createOrtSession(new ArrayBuffer(4), plan, {
    ort,
    wasmPaths: "/wasm/",
    numThreads: 2,
    sessionOptions: { enableCpuMemArena: false }
  });
  expect(ort.env.wasm.wasmPaths).toBe("/wasm/");
  expect(ort.env.wasm.numThreads).toBe(2);
  expect(ort.InferenceSession.create).toHaveBeenCalledWith(
    expect.any(ArrayBuffer),
    expect.objectContaining({ executionProviders: ["wasm"], enableCpuMemArena: false })
  );
  expect(handle.sessionMs).toBeGreaterThanOrEqual(0);
  await handle.dispose();
  await handle.dispose();
  expect(release).toHaveBeenCalledTimes(1);
});

it("AbortSignal 取消后等待底层 run 收敛再抛出 ABORTED", async () => {
  let finishRun!: (value: unknown) => void;
  const ort = {
    env: { wasm: {} },
    InferenceSession: {
      create: vi.fn().mockResolvedValue({
        run: () => new Promise((resolve) => (finishRun = resolve)),
        release: vi.fn()
      })
    }
  };
  const handle = await createOrtSession(new ArrayBuffer(1), plan, { ort });
  const controller = new AbortController();
  const pending = handle.run({ image: new Float32Array([1]) }, { signal: controller.signal });
  let settled = false;
  void pending.catch(() => undefined).finally(() => (settled = true));
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  finishRun({ output: 1 });
  await expect(pending).rejects.toMatchObject<PPDetectionError>({ code: "ABORTED" });
  await handle.dispose();
});

it("dispose 等待在途 run 完成后再释放底层 session", async () => {
  let finishRun!: (value: unknown) => void;
  const release = vi.fn();
  const ort = {
    env: { wasm: {} },
    InferenceSession: {
      create: vi.fn().mockResolvedValue({
        run: () => new Promise((resolve) => (finishRun = resolve)),
        release
      })
    }
  };
  const handle = await createOrtSession(new ArrayBuffer(1), plan, { ort });
  const running = handle.run({ image: new Float32Array([1]) });
  const disposing = handle.dispose();
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  finishRun({ output: 1 });
  await expect(running).resolves.toEqual({ output: 1 });
  await disposing;
  expect(release).toHaveBeenCalledTimes(1);
});

it("释放后 run 返回 DISPOSED", async () => {
  const ort = {
    env: { wasm: {} },
    InferenceSession: { create: vi.fn().mockResolvedValue({ run: vi.fn(), release: vi.fn() }) }
  };
  const handle = await createOrtSession(new ArrayBuffer(1), plan, { ort });
  await handle.dispose();
  await expect(handle.run({})).rejects.toMatchObject({ code: "DISPOSED" });
});

it("ORT 创建异常映射为 SESSION_CREATE_FAILED", async () => {
  const ort = {
    env: { wasm: {} },
    InferenceSession: { create: vi.fn().mockRejectedValue(new Error("bad graph")) }
  };
  await expect(createOrtSession(new ArrayBuffer(1), plan, { ort })).rejects.toMatchObject({
    code: "SESSION_CREATE_FAILED"
  });
});

it("ORT 模块加载异常映射为 SESSION_CREATE_FAILED", async () => {
  const loadOrt = vi.fn(async () => {
    throw new Error("module unavailable");
  });
  await expect(
    createOrtSession(new ArrayBuffer(1), plan, {
      loadOrt
    })
  ).rejects.toMatchObject({ code: "SESSION_CREATE_FAILED" });
  expect(loadOrt).toHaveBeenCalledTimes(1);
});
