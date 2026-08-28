import { expect, it, vi } from "vitest";
import { IndexedDBModelCache } from "../src/cache/indexeddb-cache";
import { MemoryModelCache } from "../src/cache/memory-cache";

it("current 清理不影响其他变体，global 清理全部键", async () => {
  const cache = new MemoryModelCache();
  await cache.put("a", new ArrayBuffer(2));
  await cache.put("b", new ArrayBuffer(3));
  await cache.clearCurrent("a");
  expect((await cache.estimate()).entries).toBe(1);
  await cache.clearAll();
  expect((await cache.estimate()).entries).toBe(0);
});

it("缓存读写使用副本，调用方修改不会污染缓存", async () => {
  const cache = new MemoryModelCache();
  const source = new Uint8Array([1, 2, 3]);
  await cache.put("model", source.buffer);
  source[0] = 9;
  const first = new Uint8Array((await cache.get("model"))!);
  first[1] = 8;
  expect(Array.from(new Uint8Array((await cache.get("model"))!))).toEqual([1, 2, 3]);
});

it("close 释放实例持有的模型字节", async () => {
  const cache = new MemoryModelCache();
  await cache.put("model", new ArrayBuffer(4));
  await cache.close();
  expect(await cache.estimate()).toEqual({ bytes: 0, entries: 0 });
});

it("IndexedDB 写入等待 transaction complete 后才完成", async () => {
  let putRequest!: IDBRequest<undefined>;
  const transaction = {
    onabort: null as (() => void) | null,
    oncomplete: null as (() => void) | null,
    error: null,
    objectStore: () => ({
      put: () => {
        putRequest = { result: undefined, error: null } as unknown as IDBRequest<undefined>;
        return putRequest;
      }
    })
  };
  const database = { transaction: vi.fn(() => transaction) } as unknown as IDBDatabase;
  const openRequest = { result: database, error: null } as unknown as IDBOpenDBRequest;
  const factory = { open: () => openRequest } as unknown as IDBFactory;
  const cache = new IndexedDBModelCache({ indexedDB: factory });
  let settled = false;
  const writing = cache.put("model", new ArrayBuffer(4)).finally(() => (settled = true));
  openRequest.onsuccess?.({} as Event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(typeof putRequest.onsuccess).toBe("function");
  putRequest.onsuccess?.({} as Event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  transaction.oncomplete?.();
  await writing;
  expect(settled).toBe(true);
});
