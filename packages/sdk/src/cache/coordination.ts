import type { ModelCache } from "./model-cache";

// 同一执行环境内，共享数据库的管理器使用同一失效代次和队列。
class CacheCoordinator {
  readonly caches = new Map<ModelCache, number>();
  private generation = 0;
  private readonly keys = new Map<string, number>();
  private pending: Promise<unknown> = Promise.resolve();

  guard(key: string): () => boolean {
    const generation = this.generation;
    const keyGeneration = this.keys.get(key) ?? 0;
    this.keys.set(key, keyGeneration);
    return () => generation === this.generation && keyGeneration === (this.keys.get(key) ?? 0);
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.pending.then(operation);
    this.pending = pending.catch(() => undefined);
    return pending;
  }

  clear(key?: string, matches?: (candidate: string) => boolean): Promise<void> {
    // 先使在途下载失效，再排队清理；清理后的新下载可正常写入。
    if (matches) {
      for (const [candidate, generation] of this.keys) {
        if (matches(candidate)) this.keys.set(candidate, generation + 1);
      }
    } else if (key === undefined) this.generation += 1;
    else this.keys.set(key, (this.keys.get(key) ?? 0) + 1);
    return this.run(async () => {
      const outcomes = await Promise.allSettled(
        [...this.caches.keys()].map(async (cache) => {
          if (matches && cache.list) {
            for (const entry of await cache.list()) {
              if (matches(entry.key)) await cache.clearCurrent(entry.key);
            }
          } else if (key === undefined) await cache.clearAll();
          else await cache.clearCurrent(key);
        })
      );
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
  }

  unregister(cache: ModelCache): boolean {
    const count = this.caches.get(cache) ?? 0;
    if (count > 1) {
      this.caches.set(cache, count - 1);
      return false;
    }
    this.caches.delete(cache);
    return true;
  }
}

const coordinators = new WeakMap<object, CacheCoordinator>();

export function coordinateCache(cache: ModelCache): CacheCoordinator {
  const scope = cache.scope ?? cache;
  let coordinator = coordinators.get(scope);
  if (!coordinator) {
    coordinator = new CacheCoordinator();
    coordinators.set(scope, coordinator);
  }
  coordinator.caches.set(cache, (coordinator.caches.get(cache) ?? 0) + 1);
  return coordinator;
}

const databaseScopes = new WeakMap<IDBFactory, Map<string, object>>();

export function databaseScope(factory: IDBFactory, name: string): object {
  let scopes = databaseScopes.get(factory);
  if (!scopes) {
    scopes = new Map();
    databaseScopes.set(factory, scopes);
  }
  let scope = scopes.get(name);
  if (!scope) {
    scope = {};
    scopes.set(name, scope);
  }
  return scope;
}
