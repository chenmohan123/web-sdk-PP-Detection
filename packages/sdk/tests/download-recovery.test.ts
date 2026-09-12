import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadModelAsset, type ModelDownloadProgress } from "../src/model/download";
import type { ResolvedModelAsset } from "../src/model/source-resolver";

const asset: ResolvedModelAsset = {
  model: { id: "m", version: "1" },
  variant: {
    id: "fp32",
    precision: "fp32",
    opset: 11,
    bytes: 4,
    parameterCount: 1,
    backends: ["wasm"],
    sources: []
  },
  source: {
    kind: "custom",
    repository: "custom",
    revision: "a".repeat(40),
    path: "m.onnx",
    downloadUrl: "https://example.com/m.onnx",
    bytes: 4,
    sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a"
  }
};
const validResponse = () => new Response(new Uint8Array([1, 2, 3, 4]));
function observed<T>(promise: Promise<T>) {
  const state: { value?: T; error?: unknown } = {};
  const settled = promise.then(
    (value) => {
      state.value = value;
    },
    (error) => {
      state.error = error;
    }
  );
  return { state, settled };
}
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("总时限终止忽略信号的挂起请求并清理迟到响应", async () => {
  let resolve!: (response: Response) => void;
  let signal!: AbortSignal;
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const progress = vi.fn();
  const result = observed(
    loadModelAsset(asset, {
      download: { timeoutMs: 100, idleTimeoutMs: 0, maxRetries: 0 },
      fetcher: (_url, init) => {
        signal = init!.signal!;
        return new Promise((r) => {
          resolve = r;
        });
      },
      onProgress: progress
    })
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
  expect(signal.aborted).toBe(true);
  const count = progress.mock.calls.length;
  resolve(new Response(new ReadableStream({ cancel })));
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});

it("空闲时限覆盖挂起读取且不等待底层取消完成", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const result = observed(
    loadModelAsset(asset, {
      download: { timeoutMs: 0, idleTimeoutMs: 60, maxRetries: 0 },
      fetcher: async () => new Response(new ReadableStream({ cancel }))
    })
  );
  await vi.advanceTimersByTimeAsync(60);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("持续新增字节续期空闲时限但不能突破请求总时限", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const result = observed(
    loadModelAsset(asset, {
      download: { timeoutMs: 100, idleTimeoutMs: 50, maxRetries: 0 },
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              controller = c;
            }
          })
        )
    })
  );
  await vi.advanceTimersByTimeAsync(40);
  controller.enqueue(new Uint8Array([1]));
  await vi.advanceTimersByTimeAsync(40);
  expect(result.state.error).toBeUndefined();
  controller.enqueue(new Uint8Array([2]));
  await vi.advanceTimersByTimeAsync(20);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
});

it("空字节块不能续期空闲时限", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const result = observed(
    loadModelAsset(asset, {
      download: { timeoutMs: 0, idleTimeoutMs: 50, maxRetries: 0 },
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              controller = c;
            }
          })
        )
    })
  );
  await vi.advanceTimersByTimeAsync(40);
  controller.enqueue(new Uint8Array());
  await vi.advanceTimersByTimeAsync(10);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
});

it("正常流每次进度续期空闲时限并成功校验", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const loading = loadModelAsset(asset, {
    download: { timeoutMs: 0, idleTimeoutMs: 50, maxRetries: 0 },
    fetcher: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            controller = c;
          }
        })
      )
  });
  for (const value of [1, 2, 3, 4]) {
    await vi.advanceTimersByTimeAsync(40);
    controller.enqueue(new Uint8Array([value]));
  }
  controller.close();
  expect((await loading).bytes.byteLength).toBe(4);
  expect(vi.getTimerCount()).toBe(0);
});

it("默认网络失败在同一地址重试两次并包含退避耗时", async () => {
  const calls: Array<{ url: string; cache?: RequestCache }> = [];
  const progress: ModelDownloadProgress[] = [];
  const loading = loadModelAsset(asset, {
    fetcher: async (url, init) => {
      calls.push({ url: String(url), cache: init?.cache });
      if (calls.length < 3) throw new TypeError("网络断开");
      return validResponse();
    },
    onProgress: (event) => progress.push(event)
  });
  const result = observed(loading);
  await vi.advanceTimersByTimeAsync(499);
  expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);
  await result.settled;
  expect(result.state.error).toBeUndefined();
  expect(calls).toEqual([
    { url: asset.source.downloadUrl, cache: undefined },
    { url: asset.source.downloadUrl, cache: "reload" },
    { url: asset.source.downloadUrl, cache: "reload" }
  ]);
  expect(progress.filter((event) => event.loadedBytes === 0)).toEqual([
    { loadedBytes: 0, totalBytes: 4, attempt: 1, maxAttempts: 3 },
    { loadedBytes: 0, totalBytes: 4, attempt: 2, maxAttempts: 3 },
    { loadedBytes: 0, totalBytes: 4, attempt: 3, maxAttempts: 3 }
  ]);
  expect(result.state.value!.timings.modelDownloadMs).toBeGreaterThanOrEqual(1500);
});

it.each([408, 429, 500, 502, 503, 504])("HTTP %i 重试耗尽后终止", async (status) => {
  const fetcher = vi.fn(async () => new Response("失败", { status }));
  const result = observed(loadModelAsset(asset, { fetcher }));
  await vi.advanceTimersByTimeAsync(1500);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED", details: { status } });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([404, 401, 403, 501])("HTTP %i 不重试", async (status) => {
  const fetcher = vi.fn(async () => new Response("失败", { status }));
  await expect(loadModelAsset(asset, { fetcher })).rejects.toMatchObject({
    code: "MODEL_DOWNLOAD_FAILED"
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  ["摘要错误", () => new Response(new Uint8Array([4, 3, 2, 1])), "MODEL_INTEGRITY_FAILED"],
  ["长度错误", () => new Response(new Uint8Array([1, 2])), "MODEL_INTEGRITY_FAILED"],
  [
    "错误206范围",
    () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 }),
    "MODEL_DOWNLOAD_FAILED"
  ]
])("%s不重试", async (_name, response, code) => {
  const fetcher = vi.fn(async () => response());
  await expect(loadModelAsset(asset, { fetcher })).rejects.toMatchObject({ code });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("读取异常丢弃残片，重试从零报告且只返回新完整内容", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const progress: ModelDownloadProgress[] = [];
  let attempts = 0;
  const result = observed(
    loadModelAsset(asset, {
      fetcher: async () =>
        ++attempts === 1
          ? new Response(
              new ReadableStream({
                start(c) {
                  controller = c;
                  c.enqueue(new Uint8Array([9]));
                }
              })
            )
          : validResponse(),
      onProgress: (event) => progress.push(event)
    })
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(progress.at(-1)?.loadedBytes).toBe(1);
  controller.error(new TypeError("响应中断"));
  await vi.advanceTimersByTimeAsync(500);
  await result.settled;
  expect(Array.from(new Uint8Array(result.state.value!.bytes))).toEqual([1, 2, 3, 4]);
  expect(progress).toContainEqual({ loadedBytes: 0, totalBytes: 4, attempt: 2, maxAttempts: 3 });
});

it.each(["请求", "读取", "退避"])("调用方取消%s及时结束且不再重试", async (phase) => {
  const aborter = new AbortController();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetcher = vi.fn(async () => {
    if (phase === "请求") return new Promise<Response>(() => {});
    if (phase === "退避") throw new TypeError("网络断开");
    return new Response(new ReadableStream({ cancel }));
  });
  const result = observed(loadModelAsset(asset, { fetcher, signal: aborter.signal }));
  await vi.advanceTimersByTimeAsync(0);
  aborter.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(result.state.error).toMatchObject({ code: "ABORTED" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  if (phase === "读取") expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("关闭两项时限仍可主动取消，且不产生计时器", async () => {
  const aborter = new AbortController();
  const result = observed(
    loadModelAsset(asset, {
      signal: aborter.signal,
      download: { timeoutMs: 0, idleTimeoutMs: 0, maxRetries: 0 },
      fetcher: () => new Promise<Response>(() => {})
    })
  );
  await vi.advanceTimersByTimeAsync(200000);
  expect(result.state.error).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  aborter.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(result.state.error).toMatchObject({ code: "ABORTED" });
});

it.each([
  { timeoutMs: -1 },
  { timeoutMs: 1.5 },
  { timeoutMs: 2147483648 },
  { idleTimeoutMs: NaN },
  { idleTimeoutMs: Infinity },
  { idleTimeoutMs: -1 },
  { maxRetries: -1 },
  { maxRetries: 6 },
  { maxRetries: 0.5 }
])("非法下载配置 %j 在发起请求前拒绝", async (download) => {
  const fetcher = vi.fn(async () => validResponse());
  await expect(loadModelAsset(asset, { fetcher, download })).rejects.toMatchObject({
    code: "INVALID_INPUT"
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("最多五次重试的退避封顶四秒", async () => {
  const starts: number[] = [];
  const result = observed(
    loadModelAsset(asset, {
      download: { maxRetries: 5 },
      fetcher: async () => {
        starts.push(performance.now());
        throw new TypeError("网络断开");
      }
    })
  );
  await vi.advanceTimersByTimeAsync(11500);
  expect(starts).toEqual([0, 500, 1500, 3500, 7500, 11500]);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
});

it("默认空闲时限为三十秒且超时最多请求三次", async () => {
  const signals: AbortSignal[] = [];
  const result = observed(
    loadModelAsset(asset, {
      fetcher: (_url, init) => {
        signals.push(init!.signal!);
        return new Promise<Response>(() => {});
      }
    })
  );
  await vi.advanceTimersByTimeAsync(29999);
  expect(signals).toHaveLength(1);
  expect(signals[0].aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(signals).toHaveLength(1);
  expect(signals[0].aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(signals).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(61000);
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
  expect(vi.getTimerCount()).toBe(0);
});

it("禁用空闲限制时仍受默认三分钟请求总时限约束", async () => {
  const result = observed(
    loadModelAsset(asset, {
      download: { idleTimeoutMs: 0, maxRetries: 0 },
      fetcher: () => new Promise<Response>(() => {})
    })
  );
  await vi.advanceTimersByTimeAsync(179999);
  expect(result.state.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
});

it("旧请求在重试期间返回也不能产生进度或影响新请求", async () => {
  let resolveOld!: (response: Response) => void;
  let current!: ReadableStreamDefaultController<Uint8Array>;
  let requests = 0;
  const progress: ModelDownloadProgress[] = [];
  const result = observed(
    loadModelAsset(asset, {
      download: { timeoutMs: 100, idleTimeoutMs: 0, maxRetries: 1 },
      fetcher: () =>
        ++requests === 1
          ? new Promise<Response>((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve(
              new Response(
                new ReadableStream({
                  start(controller) {
                    current = controller;
                  }
                })
              )
            ),
      onProgress: (value) => progress.push(value)
    })
  );
  await vi.advanceTimersByTimeAsync(600);
  const cancel = vi.fn(() => Promise.reject(new Error("取消失败")));
  resolveOld(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([9, 9]));
        },
        cancel
      })
    )
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(progress.map((value) => value.loadedBytes)).toEqual([0, 0]);
  current.enqueue(new Uint8Array([1, 2, 3, 4]));
  current.close();
  await result.settled;
  expect(result.state.value!.bytes.byteLength).toBe(4);
  expect(progress.at(-1)?.attempt).toBe(2);
});

it("非标准读取与取消均挂起时也及时终止，迟到块不报告进度", async () => {
  const response = new Response(new ReadableStream<Uint8Array>());
  let resolveRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
  const read = vi.fn(
    () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        resolveRead = resolve;
      })
  );
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const reader = { read, cancel, releaseLock: vi.fn(), closed: new Promise<void>(() => {}) };
  vi.spyOn(response.body!, "getReader").mockReturnValue(
    reader as ReadableStreamDefaultReader<Uint8Array>
  );
  const progress = vi.fn();
  const result = observed(
    loadModelAsset(asset, {
      fetcher: async () => response,
      onProgress: progress,
      download: { timeoutMs: 20, maxRetries: 0 }
    })
  );
  await vi.advanceTimersByTimeAsync(20);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
  expect(cancel).toHaveBeenCalledTimes(1);
  const count = progress.mock.calls.length;
  resolveRead({ done: false, value: new Uint8Array([1, 2, 3, 4]) });
  await vi.advanceTimersByTimeAsync(0);
  expect(progress).toHaveBeenCalledTimes(count);
  expect(read).toHaveBeenCalledTimes(1);
});

it("迟到的请求拒绝由原调用链接收，不触发新的重试", async () => {
  let reject!: (error: unknown) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((_resolve, fail) => {
        reject = fail;
      })
  );
  const result = observed(
    loadModelAsset(asset, { fetcher, download: { timeoutMs: 10, maxRetries: 0 } })
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(result.state.error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
  reject(new TypeError("迟到网络错误"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("请求自身报告 AbortError 时不重试", async () => {
  const fetcher = vi.fn(async () => {
    throw new DOMException("已取消", "AbortError");
  });
  await expect(loadModelAsset(asset, { fetcher })).rejects.toMatchObject({ code: "ABORTED" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("应用进度回调异常不能误判为网络失败重试", async () => {
  const error = new Error("应用回调失败");
  const fetcher = vi.fn(async () => validResponse());
  await expect(
    loadModelAsset(asset, {
      fetcher,
      onProgress: (progress) => {
        if (progress.loadedBytes > 0) throw error;
      }
    })
  ).rejects.toBe(error);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
