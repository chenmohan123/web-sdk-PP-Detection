export interface CacheEstimate {
  readonly bytes: number;
  readonly entries: number;
}

export interface ModelCache {
  readonly scope?: object;
  get(key: string): Promise<ArrayBuffer | undefined>;
  put(key: string, bytes: ArrayBuffer): Promise<void>;
  clearCurrent(key: string): Promise<void>;
  clearAll(): Promise<void>;
  estimate(): Promise<CacheEstimate>;
  list?(): Promise<readonly { key: string; bytes: number }[]>;
  close?(): Promise<void> | void;
}

export class TieredModelCache implements ModelCache {
  readonly scope: object;
  constructor(
    private readonly memory: ModelCache,
    private readonly persistent?: ModelCache
  ) {
    this.scope = persistent?.scope ?? persistent ?? memory;
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    const memoryValue = await this.memory.get(key);
    if (memoryValue) return memoryValue;
    const persistentValue = await this.persistent?.get(key);
    if (persistentValue) await this.memory.put(key, persistentValue);
    return persistentValue;
  }

  async put(key: string, bytes: ArrayBuffer): Promise<void> {
    await this.memory.put(key, bytes);
    await this.persistent?.put(key, bytes);
  }

  async clearCurrent(key: string): Promise<void> {
    await this.memory.clearCurrent(key);
    await this.persistent?.clearCurrent(key);
  }

  async clearAll(): Promise<void> {
    await this.memory.clearAll();
    await this.persistent?.clearAll();
  }

  estimate(): Promise<CacheEstimate> {
    return this.persistent?.estimate() ?? this.memory.estimate();
  }

  async list(): Promise<readonly { key: string; bytes: number }[]> {
    const entries = new Map<string, { key: string; bytes: number }>();
    for (const cache of [this.memory, this.persistent]) {
      for (const entry of (await cache?.list?.()) ?? []) entries.set(entry.key, entry);
    }
    return [...entries.values()];
  }

  async close(): Promise<void> {
    await this.memory.close?.();
    await this.persistent?.close?.();
  }
}
