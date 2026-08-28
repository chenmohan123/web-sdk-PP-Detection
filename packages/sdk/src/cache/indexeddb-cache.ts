import type { CacheEstimate, ModelCache } from "./model-cache";

interface ModelCacheRecord {
  readonly key: string;
  readonly bytes: ArrayBuffer;
  readonly size: number;
}

export interface IndexedDBModelCacheOptions {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
}

export class IndexedDBModelCache implements ModelCache {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private database?: Promise<IDBDatabase>;

  constructor(options: IndexedDBModelCacheOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error("当前环境不支持 IndexedDB");
    this.factory = factory;
    this.databaseName = options.databaseName ?? "web-sdk-pp-detection-models-v1";
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    const record = await this.request<ModelCacheRecord | undefined>(
      "readonly",
      (store) => store.get(key) as IDBRequest<ModelCacheRecord | undefined>
    );
    return record?.bytes.slice(0);
  }

  async put(key: string, bytes: ArrayBuffer): Promise<void> {
    const stored = bytes.slice(0);
    await this.request("readwrite", (store) =>
      store.put({ key, bytes: stored, size: stored.byteLength } satisfies ModelCacheRecord)
    );
  }

  async clearCurrent(key: string): Promise<void> {
    await this.request("readwrite", (store) => store.delete(key));
  }

  async clearAll(): Promise<void> {
    await this.request("readwrite", (store) => store.clear());
  }

  async estimate(): Promise<CacheEstimate> {
    const database = await this.open();
    return await new Promise<CacheEstimate>((resolve, reject) => {
      const transaction = database.transaction("models", "readonly");
      const request = transaction.objectStore("models").openCursor();
      let bytes = 0;
      let entries = 0;
      let cursorFinished = false;
      request.onerror = () => reject(request.error ?? new Error("读取 IndexedDB 缓存失败"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          cursorFinished = true;
          return;
        }
        const value = cursor.value as ModelCacheRecord;
        bytes += typeof value.size === "number" ? value.size : value.bytes.byteLength;
        entries += 1;
        cursor.continue();
      };
      transaction.oncomplete = () => {
        if (cursorFinished) resolve({ bytes, entries });
        else reject(new Error("IndexedDB 缓存游标未完成"));
      };
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 缓存事务中止"));
    });
  }

  async close(): Promise<void> {
    if (!this.database) return;
    (await this.database).close();
    this.database = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("models"))
          request.result.createObjectStore("models", { keyPath: "key" });
      };
      request.onerror = () => reject(request.error ?? new Error("打开 IndexedDB 缓存失败"));
      request.onsuccess = () => resolve(request.result);
      request.onblocked = () => reject(new Error("IndexedDB 缓存升级被阻塞"));
    });
    this.database.catch(() => {
      this.database = undefined;
    });
    return this.database;
  }

  private async request<T = undefined>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const database = await this.open();
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("models", mode);
      const request = operation(transaction.objectStore("models"));
      let requestFinished = false;
      let result: T;
      request.onerror = () => reject(request.error ?? new Error("IndexedDB 缓存操作失败"));
      request.onsuccess = () => {
        requestFinished = true;
        result = request.result;
      };
      transaction.oncomplete = () => {
        if (requestFinished) resolve(result);
        else reject(new Error("IndexedDB 缓存请求未完成"));
      };
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 缓存事务中止"));
    });
  }
}
