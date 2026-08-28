import { expect, it, vi } from "vitest";
import { ModelManager } from "../src/model/model-manager";
import { PPDetectionError } from "../src/errors";
import type { ModelCache } from "../src/cache/model-cache";

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
  expect(fetcher).toHaveBeenCalledTimes(1);
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
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
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
  expect(progress).toHaveBeenLastCalledWith({ loadedBytes: 4, totalBytes: 4 });

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
