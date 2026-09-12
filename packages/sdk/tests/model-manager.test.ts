import { expect, it, vi } from "vitest";
import { ModelManager } from "../src/model/model-manager";
import { PPDetectionError } from "../src/errors";
import type { ModelCache } from "../src/cache/model-cache";
import { MemoryModelCache } from "../src/cache/memory-cache";

const validSha256 = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";
const source = {
  kind: "custom" as const,
  repository: "custom",
  revision: "a".repeat(40),
  path: "m.onnx",
  downloadUrl: "https://example.com/m.onnx",
  bytes: 4,
  sha256: "a".repeat(64)
};
const manifest = {
  schemaVersion: 1,
  model: { id: "m", version: "1" },
  input: { name: "image", shape: [1, 3, 1, 1], dtype: "float32" },
  outputs: [{ name: "dets", shape: [1, 1, 6], dtype: "float32" }],
  preprocessing: { size: { width: 1, height: 1 }, rescaleFactor: 1 },
  postprocessing: { type: "nms", scoreThreshold: 0.4, iouThreshold: 0.5 },
  labels: ["x"],
  variants: [
    {
      id: "fp32",
      precision: "fp32",
      quantization: null,
      opset: 11,
      bytes: 4,
      parameterCount: 1,
      backends: ["wasm"],
      sources: [source]
    }
  ]
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const validManifest = {
  ...manifest,
  variants: [{ ...manifest.variants[0], sources: [{ ...source, sha256: validSha256 }] }]
};

it("共享存储范围的容量包含其他活动管理器的内存副本并按键去重", async () => {
  const scope = {};
  const firstCache = Object.assign(new MemoryModelCache(), { scope });
  const secondCache = Object.assign(new MemoryModelCache(), { scope });
  const fetcher = async () => new Response(new Uint8Array([1, 2, 3, 4]));
  const first = new ModelManager({ cache: firstCache, fetcher });
  const second = new ModelManager({ cache: secondCache, fetcher });
  await first.load({ manifest: validManifest });
  expect(await second.getCacheEstimate()).toEqual({ bytes: 4, entries: 1 });
  await second.load({ manifest: validManifest });
  expect(await second.getCacheEstimate()).toEqual({ bytes: 4, entries: 1 });
  await second.load({ manifest: { ...validManifest, model: { id: "other", version: "1" } } });
  expect(await first.getCacheEstimate()).toEqual({ bytes: 8, entries: 2 });
  await Promise.all([first.dispose(), second.dispose()]);
});

it("按实际模型身份清理全部变体和来源，同时保留其他模型和 SDK", async () => {
  const cache = new MemoryModelCache();
  const manager = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  await cache.put("other-sdk:weight", new ArrayBuffer(7));
  await manager.load({ manifest: validManifest });
  await manager.load({
    manifest: { ...validManifest, variants: [{ ...validManifest.variants[0], id: "another" }] }
  });
  await manager.load({ manifest: { ...validManifest, model: { id: "other", version: "1" } } });
  expect(await manager.getCacheEstimate(validManifest.model)).toEqual({ bytes: 8, entries: 2 });
  await manager.clearCurrentModelCache(validManifest.model);
  expect(await manager.getCacheEstimate(validManifest.model)).toEqual({ bytes: 0, entries: 0 });
  expect(await manager.getCacheEstimate()).toEqual({ bytes: 4, entries: 1 });
  await manager.clearAllCache();
  expect(await cache.estimate()).toEqual({ bytes: 7, entries: 1 });
  await manager.dispose();
});

it("不支持列举的自定义缓存拒绝按身份清理，不能扩大到全部缓存", async () => {
  const memory = new MemoryModelCache();
  await memory.put("foreign", new ArrayBuffer(7));
  const cache: ModelCache = {
    get: (key) => memory.get(key),
    put: (key, bytes) => memory.put(key, bytes),
    clearCurrent: (key) => memory.clearCurrent(key),
    clearAll: () => memory.clearAll(),
    estimate: () => memory.estimate()
  };
  const manager = new ModelManager({ cache });
  await expect(manager.clearCurrentModelCache(validManifest.model)).rejects.toMatchObject({
    code: "CAPABILITY_UNSUPPORTED"
  });
  expect(await memory.estimate()).toEqual({ bytes: 7, entries: 1 });
  await manager.dispose();
});

it("清理前开始的 auto 加载不能由迟到后备来源写回", async () => {
  const gate = deferred();
  const entered = deferred();
  const cache = new MemoryModelCache();
  let calls = 0;
  const manager = new ModelManager({
    cache,
    fetcher: async () => {
      if (++calls === 1) {
        entered.release();
        await gate.promise;
        return new Response("失败", { status: 404 });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }
  });
  const loading = manager.load({
    manifest: {
      ...validManifest,
      variants: [
        {
          ...validManifest.variants[0],
          sources: [
            validManifest.variants[0].sources[0],
            {
              ...validManifest.variants[0].sources[0],
              kind: "huggingface",
              revision: "b".repeat(40)
            }
          ]
        }
      ]
    }
  });
  await entered.promise;
  await manager.clearAllCache();
  gate.release();
  await loading;
  expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  await manager.dispose();
});

it("共享自定义缓存的一个 manager 释放后，另一个仍可清理", async () => {
  const cache = new MemoryModelCache();
  const first = new ModelManager({ cache });
  const second = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  await first.dispose();
  await second.load({ manifest: validManifest });
  await second.clearAllCache();
  expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  await second.dispose();
});

it("清理等待已开始的缓存事务完成后删除", async () => {
  const gate = deferred();
  const entered = deferred();
  class DelayedCache extends MemoryModelCache {
    override async put(key: string, bytes: ArrayBuffer) {
      await super.put(key, bytes);
      entered.release();
      await gate.promise;
    }
  }
  const cache = new DelayedCache();
  const manager = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  const loading = manager.load({ manifest: validManifest });
  await entered.promise;
  let cleared = false;
  const clearing = manager.clearAllCache().then(() => {
    cleared = true;
  });
  await Promise.resolve();
  expect(cleared).toBe(false);
  gate.release();
  await Promise.all([loading, clearing]);
  expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  await manager.dispose();
});

it("迟到的损坏缓存校验不能删除清理后新写入的数据", async () => {
  const gate = deferred();
  const entered = deferred();
  const cache = new MemoryModelCache();
  const first = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  const second = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  const key = first.cacheKey(
    validManifest.variants[0],
    validManifest.variants[0].sources[0],
    validManifest.model
  );
  await cache.put(key, new Uint8Array([4, 3, 2, 1]).buffer);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const spy = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (algorithm, bytes) => {
    entered.release();
    await gate.promise;
    return digest(algorithm, bytes);
  });
  try {
    const old = first.load({ manifest: validManifest });
    await entered.promise;
    await second.clearAllCache();
    await second.load({ manifest: validManifest });
    gate.release();
    await old;
    expect(Array.from(new Uint8Array((await cache.get(key))!))).toEqual([1, 2, 3, 4]);
    expect(await cache.estimate()).toEqual({ bytes: 4, entries: 1 });
  } finally {
    gate.release();
    spy.mockRestore();
    await Promise.all([first.dispose(), second.dispose()]);
  }
});

it.each(["current", "all"] as const)("%s 清理阻止旧下载写回且保留新缓存", async (scope) => {
  const gate = deferred();
  const entered = deferred();
  const cache = new MemoryModelCache();
  const oldManager = new ModelManager({
    cache,
    fetcher: async () => {
      entered.release();
      await gate.promise;
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }
  });
  const newManager = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  const oldLoad = oldManager.load({ manifest: validManifest });
  await entered.promise;
  if (scope === "current") await oldManager.clearCurrentModelCache();
  else await newManager.clearAllCache();
  expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  gate.release();
  await oldLoad;
  expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  await newManager.load({ manifest: validManifest });
  expect(await cache.estimate()).toEqual({ bytes: 4, entries: 1 });
  await Promise.all([oldManager.dispose(), newManager.dispose()]);
});

it("清理后先完成的新加载不会被迟到旧任务覆盖或删除", async () => {
  const gate = deferred();
  const entered = deferred();
  const cache = new MemoryModelCache();
  const oldManager = new ModelManager({
    cache,
    fetcher: async () => {
      entered.release();
      await gate.promise;
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }
  });
  const newManager = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  const oldLoad = oldManager.load({ manifest: validManifest });
  await entered.promise;
  await newManager.clearAllCache();
  await newManager.load({ manifest: validManifest });
  const put = vi.spyOn(cache, "put");
  gate.release();
  await oldLoad;
  expect(put).not.toHaveBeenCalled();
  expect(await cache.estimate()).toEqual({ bytes: 4, entries: 1 });
  await Promise.all([oldManager.dispose(), newManager.dispose()]);
});

it("当前清理只影响选定缓存键，清理失败后可以重试和加载", async () => {
  const cache = new MemoryModelCache();
  const manager = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  await manager.load({ manifest: { ...validManifest, model: { id: "other", version: "1" } } });
  await manager.load({ manifest: validManifest });
  vi.spyOn(cache, "clearCurrent").mockRejectedValueOnce(new Error("临时事务错误"));
  await expect(manager.clearCurrentModelCache()).rejects.toThrow("临时事务错误");
  await manager.clearCurrentModelCache();
  expect(await manager.estimate()).toEqual({ bytes: 4, entries: 1 });
  await manager.load({ manifest: validManifest });
  expect(await manager.estimate()).toEqual({ bytes: 8, entries: 2 });
  await manager.dispose();
});

it("显式来源失败不自动换源，完整性失败不写缓存", async () => {
  const fetcher = async () => new Response(new Uint8Array([1, 2, 3, 4]));
  const manager = new ModelManager({ fetcher, cache: "memory" });
  await expect(
    manager.load({ manifest, variantId: "fp32", sourceKind: "custom" })
  ).rejects.toMatchObject<PPDetectionError>({ code: "MODEL_INTEGRITY_FAILED" });
  expect((await manager.estimate()).entries).toBe(0);
});

it("缓存键随 revision 和 sha 变化", () => {
  const manager = new ModelManager({ cache: "memory" });
  const original = manager.cacheKey(manifest.variants[0], source, manifest.model);
  expect(original).not.toBe(
    manager.cacheKey(manifest.variants[0], { ...source, revision: "b".repeat(40) }, manifest.model)
  );
  expect(original).not.toBe(
    manager.cacheKey(manifest.variants[0], { ...source, sha256: "b".repeat(64) }, manifest.model)
  );
  expect(original).not.toBe(
    manager.cacheKey({ ...manifest.variants[0], id: "fp16" }, source, manifest.model)
  );
  expect(original).not.toBe(
    manager.cacheKey(manifest.variants[0], source, { ...manifest.model, version: "2" })
  );
});

it("显式来源下载失败时不尝试其他来源", async () => {
  const fallback = {
    ...source,
    kind: "huggingface" as const,
    revision: "b".repeat(40),
    downloadUrl: "https://huggingface.co/repo/m.onnx"
  };
  const fetcher = vi.fn(async () => {
    throw new TypeError("CORS blocked");
  });
  const manager = new ModelManager({ fetcher, cache: "memory" });
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [source, fallback] }]
  };

  await expect(
    manager.load({ manifest: candidate, variantId: "fp32", sourceKind: "custom" })
  ).rejects.toMatchObject({
    code: "MODEL_SOURCE_UNAVAILABLE"
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("auto 按清单顺序尝试来源并返回实际来源", async () => {
  const first = { ...source, sha256: validSha256 };
  const second = {
    ...first,
    kind: "huggingface" as const,
    revision: "b".repeat(40),
    downloadUrl: "https://huggingface.co/repo/m.onnx"
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 404 }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])));
  const manager = new ModelManager({ fetcher, cache: "memory" });
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [first, second] }]
  };

  const loaded = await manager.load({ manifest: candidate, variantId: "fp32", sourceKind: "auto" });
  expect(loaded.source.kind).toBe("huggingface");
  expect(loaded.failures).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("校验通过后写缓存，后续加载不再请求网络", async () => {
  const validSource = { ...source, sha256: validSha256 };
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [validSource] }]
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
  const manager = new ModelManager({ fetcher, cache: "memory" });

  expect(
    (await manager.load({ manifest: candidate, variantId: "fp32", sourceKind: "custom" })).fromCache
  ).toBe(false);
  expect(
    (await manager.load({ manifest: candidate, variantId: "fp32", sourceKind: "custom" })).fromCache
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("完整性失败不会调用缓存写入", async () => {
  const put = vi.fn();
  const cache: ModelCache = {
    get: vi.fn(),
    put,
    clearCurrent: vi.fn(),
    clearAll: vi.fn(),
    estimate: vi.fn(async () => ({ bytes: 0, entries: 0 }))
  };
  const manager = new ModelManager({
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4])),
    cache
  });
  await expect(
    manager.load({ manifest, variantId: "fp32", sourceKind: "custom" })
  ).rejects.toMatchObject({ code: "MODEL_INTEGRITY_FAILED" });
  expect(put).not.toHaveBeenCalled();
});

it("流式下载报告已加载字节并支持取消", async () => {
  const progress = vi.fn();
  const validSource = { ...source, sha256: validSha256 };
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [validSource] }]
  };
  const manager = new ModelManager({
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4])),
    cache: "memory"
  });
  await manager.load({ manifest: candidate, sourceKind: "custom", onProgress: progress });
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({ loadedBytes: 4, totalBytes: 4 })
  );

  const controller = new AbortController();
  controller.abort();
  const anotherManager = new ModelManager({ cache: "memory" });
  await expect(
    anotherManager.load({ manifest: candidate, sourceKind: "custom", signal: controller.signal })
  ).rejects.toMatchObject({ code: "ABORTED" });
});

it("缓存写入失败不切换来源，已校验模型仍可使用", async () => {
  const first = { ...source, sha256: validSha256 };
  const second = {
    ...first,
    kind: "huggingface" as const,
    revision: "b".repeat(40),
    downloadUrl: "https://huggingface.co/repo/m.onnx"
  };
  const cache: ModelCache = {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => {
      throw new DOMException("quota", "QuotaExceededError");
    }),
    clearCurrent: vi.fn(),
    clearAll: vi.fn(),
    estimate: vi.fn(async () => ({ bytes: 0, entries: 0 }))
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
  const manager = new ModelManager({ fetcher, cache });
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [first, second] }]
  };

  const loaded = await manager.load({ manifest: candidate, sourceKind: "auto" });
  expect(loaded.source.kind).toBe("custom");
  expect(loaded.failures).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("缓存读取失败时按 cache miss 下载模型", async () => {
  const cache: ModelCache = {
    get: vi.fn(async () => {
      throw new DOMException("blocked", "SecurityError");
    }),
    put: vi.fn(),
    clearCurrent: vi.fn(),
    clearAll: vi.fn(),
    estimate: vi.fn(async () => ({ bytes: 0, entries: 0 }))
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
  const manager = new ModelManager({ fetcher, cache });
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [{ ...source, sha256: validSha256 }] }]
  };

  const loaded = await manager.load({ manifest: candidate, sourceKind: "custom" });
  expect(loaded.fromCache).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("删除损坏缓存失败时仍从网络重新下载", async () => {
  const cache: ModelCache = {
    get: vi.fn(async () => new Uint8Array([4, 3, 2, 1]).buffer),
    put: vi.fn(),
    clearCurrent: vi.fn(async () => {
      throw new DOMException("transaction failed", "InvalidStateError");
    }),
    clearAll: vi.fn(),
    estimate: vi.fn(async () => ({ bytes: 4, entries: 1 }))
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
  const manager = new ModelManager({ fetcher, cache });
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [{ ...source, sha256: validSha256 }] }]
  };

  const loaded = await manager.load({ manifest: candidate, sourceKind: "custom" });
  expect(loaded.fromCache).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("dispose 取消并等待在途 load，完成后才关闭缓存", async () => {
  let finishFetch!: (response: Response) => void;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => (markFetchStarted = resolve));
  const close = vi.fn();
  const cache: ModelCache = {
    get: vi.fn(async () => undefined),
    put: vi.fn(),
    clearCurrent: vi.fn(),
    clearAll: vi.fn(),
    estimate: vi.fn(async () => ({ bytes: 0, entries: 0 })),
    close
  };
  const manager = new ModelManager({
    fetcher: () => {
      markFetchStarted();
      return new Promise((resolve) => (finishFetch = resolve));
    },
    cache
  });
  const candidate = {
    ...manifest,
    variants: [{ ...manifest.variants[0], sources: [{ ...source, sha256: validSha256 }] }]
  };
  const loading = manager.load({ manifest: candidate, sourceKind: "custom" });
  await fetchStarted;
  const disposing = manager.dispose();
  await Promise.resolve();
  expect(close).not.toHaveBeenCalled();
  finishFetch(new Response(new Uint8Array([1, 2, 3, 4])));
  await expect(loading).rejects.toMatchObject({ code: "ABORTED" });
  await disposing;
  expect(cache.put).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  await expect(manager.load({ manifest: candidate })).rejects.toMatchObject({ code: "DISPOSED" });
});

it("下载策略经管理器传递，显式来源重试耗尽不换源且不写缓存", async () => {
  vi.useFakeTimers();
  const cache = new MemoryModelCache();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL) => new Response("暂不可用", { status: 503 })
  );
  const manager = new ModelManager({ cache, fetcher, download: { maxRetries: 1 } });
  try {
    const loading = manager.load({ manifest: validManifest, sourceKind: "custom" });
    const failure = expect(loading).rejects.toMatchObject({
      code: "MODEL_SOURCE_UNAVAILABLE",
      cause: { code: "MODEL_DOWNLOAD_FAILED" }
    });
    await vi.advanceTimersByTimeAsync(500);
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => call[0] === source.downloadUrl)).toBe(true);
    expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  } finally {
    await manager.dispose();
    vi.useRealTimers();
  }
});

it("释放管理器及时取消不遵守信号的请求并阻止迟到缓存写入", async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const cache = new MemoryModelCache();
  const manager = new ModelManager({
    cache,
    fetcher: () =>
      new Promise((r) => {
        resolve = r;
      })
  });
  const loading = manager.load({ manifest: validManifest, sourceKind: "custom" });
  const outcome: { error?: unknown; disposed?: boolean } = {};
  void loading.catch((error) => {
    outcome.error = error;
  });
  await vi.advanceTimersByTimeAsync(0);
  void manager.dispose().then(() => {
    outcome.disposed = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  try {
    expect(outcome).toMatchObject({ error: { code: "ABORTED" }, disposed: true });
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
  } finally {
    vi.useRealTimers();
  }
});

it("重试成功后只缓存完整权重，后续加载直接命中缓存", async () => {
  vi.useFakeTimers();
  const cache = new MemoryModelCache();
  let requests = 0;
  const manager = new ModelManager({
    cache,
    fetcher: async () => {
      if (++requests === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([9]));
              controller.error(new TypeError("连接中断"));
            }
          })
        );
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }
  });
  try {
    const loading = manager.load({ manifest: validManifest, sourceKind: "custom" });
    const checked = loading.then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
    await vi.advanceTimersByTimeAsync(500);
    const outcome = await checked;
    expect(outcome.error).toBeUndefined();
    expect(outcome.value!.fromCache).toBe(false);
    const cached = await manager.load({ manifest: validManifest, sourceKind: "custom" });
    expect(cached.fromCache).toBe(true);
    expect(Array.from(new Uint8Array(cached.bytes))).toEqual([1, 2, 3, 4]);
    expect(requests).toBe(2);
    expect(await cache.estimate()).toEqual({ bytes: 4, entries: 1 });
  } finally {
    await manager.dispose();
    vi.useRealTimers();
  }
});

it("并发下载各自拥有取消控制，取消一个不影响另一个成功缓存", async () => {
  vi.useFakeTimers();
  const cache = new MemoryModelCache();
  const aborter = new AbortController();
  const manager = new ModelManager({ cache, fetcher: () => new Promise<Response>(() => {}) });
  const other = new ModelManager({
    cache,
    fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]))
  });
  let failure: unknown;
  void manager.load({ manifest: validManifest, signal: aborter.signal }).catch((error) => {
    failure = error;
  });
  const loading = other.load({ manifest: validManifest });
  await vi.advanceTimersByTimeAsync(0);
  aborter.abort();
  await vi.advanceTimersByTimeAsync(0);
  try {
    expect(failure).toMatchObject({ code: "ABORTED" });
    expect((await loading).bytes.byteLength).toBe(4);
    expect(await cache.estimate()).toEqual({ bytes: 4, entries: 1 });
  } finally {
    await Promise.all([manager.dispose(), other.dispose()]);
    vi.useRealTimers();
  }
});
