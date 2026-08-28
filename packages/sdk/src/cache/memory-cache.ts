import type { CacheEstimate, ModelCache } from "./model-cache";

function clone(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

export class MemoryModelCache implements ModelCache {
  private readonly entries = new Map<string, ArrayBuffer>();

  get(key: string): Promise<ArrayBuffer | undefined> {
    const value = this.entries.get(key);
    return Promise.resolve(value ? clone(value) : undefined);
  }

  put(key: string, bytes: ArrayBuffer): Promise<void> {
    this.entries.set(key, clone(bytes));
    return Promise.resolve();
  }

  clearCurrent(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  clearAll(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  estimate(): Promise<CacheEstimate> {
    let bytes = 0;
    for (const value of this.entries.values()) bytes += value.byteLength;
    return Promise.resolve({ bytes, entries: this.entries.size });
  }

  close(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }
}
