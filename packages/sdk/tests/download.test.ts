import { expect, it, vi } from "vitest";
import { loadModelAsset } from "../src/model/download";
import type { ResolvedModelAsset } from "../src/model/source-resolver";

const asset: ResolvedModelAsset = {
  model: { id: "m", version: "1" },
  variant: {
    id: "fp32",
    precision: "fp32",
    quantization: null,
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

it("按 Response 流读取模型并报告进度和耗时", async () => {
  const onProgress = vi.fn();
  const result = await loadModelAsset(asset, {
    fetcher: async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } }),
    onProgress
  });
  expect(Array.from(new Uint8Array(result.bytes))).toEqual([1, 2, 3, 4]);
  expect(result.timings.modelDownloadMs).toBeGreaterThanOrEqual(0);
  expect(result.timings.integrityMs).toBeGreaterThanOrEqual(0);
  expect(onProgress).toHaveBeenLastCalledWith({ loadedBytes: 4, totalBytes: 4 });
});

it("Content-Length 与清单不一致时在读取前拒绝", async () => {
  await expect(
    loadModelAsset(asset, {
      fetcher: async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "5" } })
    })
  ).rejects.toMatchObject({ code: "MODEL_INTEGRITY_FAILED" });
});

it("HTTP 失败映射为下载错误", async () => {
  await expect(
    loadModelAsset(asset, {
      fetcher: async () => new Response("missing", { status: 404 })
    })
  ).rejects.toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
});

it.each([
  ["缺少 Content-Range", undefined],
  ["范围不完整", "bytes 1-3/4"],
  ["总大小不匹配", "bytes 0-3/5"]
])("206 响应%s时拒绝", async (_name, contentRange) => {
  const headers = new Headers({ "content-length": "4" });
  if (contentRange) headers.set("content-range", contentRange);
  await expect(
    loadModelAsset(asset, {
      fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers })
    })
  ).rejects.toMatchObject({ code: "MODEL_DOWNLOAD_FAILED" });
});

it("接受覆盖完整模型的 206 Content-Range", async () => {
  const result = await loadModelAsset(asset, {
    fetcher: async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "content-length": "4", "content-range": "bytes 0-3/4" }
      })
  });
  expect(result.bytes.byteLength).toBe(4);
});

it("响应流超过清单大小时取消底层流", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
    },
    cancel
  });
  await expect(
    loadModelAsset(asset, { fetcher: async () => new Response(stream) })
  ).rejects.toMatchObject({ code: "MODEL_INTEGRITY_FAILED" });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("读取响应流异常时调用 reader.cancel", async () => {
  const cancel = vi.fn();
  const releaseLock = vi.fn();
  const response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: vi.fn(async () => {
          throw new Error("stream broken");
        }),
        cancel,
        releaseLock
      })
    }
  } as unknown as Response;
  await expect(loadModelAsset(asset, { fetcher: async () => response })).rejects.toMatchObject({
    code: "MODEL_DOWNLOAD_FAILED"
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(releaseLock).toHaveBeenCalledTimes(1);
});
