import { IndexedDBModelCache } from "../cache/indexeddb-cache";
import { MemoryModelCache } from "../cache/memory-cache";
import { TieredModelCache, type CacheEstimate, type ModelCache } from "../cache/model-cache";
import { PPDetectionError } from "../errors";
import type {
  DetectionModelVariant,
  ModelIdentity,
  ModelSource,
  ModelSourceKind,
  RuntimeDetectionManifest,
  TimingBreakdown
} from "../types";
import { loadModelAsset, type ModelDownloadProgress, type ModelFetcher } from "./download";
import { verifyModelIntegrity } from "./integrity";
import { parseDetectionManifest } from "./manifest";
import {
  resolveModelSources,
  resolveModelVariant,
  type ModelSourceSelection,
  type ResolvedModelAsset
} from "./source-resolver";

const SDK_CACHE_NAMESPACE = "web-sdk-pp-detection:cache-v1";

export interface ModelManagerOptions {
  readonly fetcher?: ModelFetcher;
  readonly cache?: "memory" | "indexeddb" | false | ModelCache;
}

export interface LoadManagedModelOptions {
  readonly manifest: unknown;
  readonly variantId?: string;
  readonly sourceKind?: ModelSourceSelection;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ModelDownloadProgress) => void;
}

export interface ModelSourceFailure {
  readonly kind: ModelSourceKind;
  readonly code: string;
  readonly message: string;
}

export interface LoadedManagedModel {
  readonly bytes: ArrayBuffer;
  readonly manifest: RuntimeDetectionManifest;
  readonly variant: DetectionModelVariant;
  readonly source: ModelSource;
  readonly cacheKey: string;
  readonly fromCache: boolean;
  readonly failures: readonly ModelSourceFailure[];
  readonly timings: TimingBreakdown;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function createCache(selection: ModelManagerOptions["cache"]): ModelCache {
  if (selection && typeof selection === "object") return selection;
  const memory = new MemoryModelCache();
  if (selection === false || selection === "memory" || typeof globalThis.indexedDB === "undefined")
    return memory;
  return new TieredModelCache(memory, new IndexedDBModelCache());
}

function sourceFailure(source: ModelSource, error: unknown): ModelSourceFailure {
  return {
    kind: source.kind,
    code: error instanceof PPDetectionError ? error.code : "MODEL_DOWNLOAD_FAILED",
    message: error instanceof Error ? error.message : String(error)
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PPDetectionError("ABORTED", "模型加载已取消");
}

export class ModelManager {
  private readonly fetcher?: ModelFetcher;
  private readonly cache: ModelCache;
  private readonly lifecycle = new AbortController();
  private readonly activeLoads = new Set<Promise<void>>();
  private currentKey?: string;
  private disposed = false;
  private disposePromise?: Promise<void>;

  constructor(options: ModelManagerOptions = {}) {
    this.fetcher = options.fetcher;
    this.cache = createCache(options.cache);
  }

  cacheKey(
    variant: DetectionModelVariant,
    source: ModelSource,
    model: ModelIdentity = { id: "unknown", version: "unknown" }
  ): string {
    return JSON.stringify([
      SDK_CACHE_NAMESPACE,
      model.id,
      model.version,
      variant.id,
      source.revision.toLowerCase(),
      source.sha256.toLowerCase()
    ]);
  }

  async load(options: LoadManagedModelOptions): Promise<LoadedManagedModel> {
    if (this.disposed) throw new PPDetectionError("DISPOSED", "模型管理器已释放");
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    this.lifecycle.signal.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted || this.lifecycle.signal.aborted) abort();
    const operation = this.loadActive({ ...options, signal: controller.signal });
    const tracked = operation.then(
      () => undefined,
      () => undefined
    );
    this.activeLoads.add(tracked);
    try {
      return await operation;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.lifecycle.signal.removeEventListener("abort", abort);
      this.activeLoads.delete(tracked);
    }
  }

  private async loadActive(options: LoadManagedModelOptions): Promise<LoadedManagedModel> {
    throwIfAborted(options.signal);
    const manifest = parseDetectionManifest(options.manifest);
    const variant = resolveModelVariant(manifest, options.variantId);
    const sourceKind = options.sourceKind ?? "auto";
    const sources = resolveModelSources(variant, sourceKind);
    const failures: ModelSourceFailure[] = [];
    let lastError: unknown;

    for (const source of sources) {
      throwIfAborted(options.signal);
      const asset: ResolvedModelAsset = { model: manifest.model, variant, source };
      const cacheKey = this.cacheKey(variant, source, manifest.model);
      const cacheStarted = now();
      let cached: ArrayBuffer | undefined;
      try {
        cached = await this.cache.get(cacheKey);
      } catch (error) {
        if (error instanceof PPDetectionError && error.code === "ABORTED") throw error;
        throwIfAborted(options.signal);
      }
      throwIfAborted(options.signal);
      const modelCacheReadMs = now() - cacheStarted;
      if (cached) {
        const integrityStarted = now();
        try {
          await verifyModelIntegrity(cached, source, options.signal);
          this.currentKey = cacheKey;
          return {
            bytes: cached,
            manifest,
            variant,
            source,
            cacheKey,
            fromCache: true,
            failures,
            timings: { modelCacheReadMs, integrityMs: now() - integrityStarted }
          };
        } catch (error) {
          if (error instanceof PPDetectionError && error.code === "ABORTED") throw error;
          try {
            await this.cache.clearCurrent(cacheKey);
          } catch (clearError) {
            if (clearError instanceof PPDetectionError && clearError.code === "ABORTED")
              throw clearError;
            throwIfAborted(options.signal);
          }
        }
      }

      let loaded;
      try {
        loaded = await loadModelAsset(asset, {
          fetcher: this.fetcher,
          signal: options.signal,
          onProgress: options.onProgress
        });
      } catch (error) {
        if (error instanceof PPDetectionError && error.code === "ABORTED") throw error;
        lastError = error;
        failures.push(sourceFailure(source, error));
        if (sourceKind !== "auto") {
          if (error instanceof PPDetectionError && error.code === "MODEL_INTEGRITY_FAILED")
            throw error;
          throw new PPDetectionError(
            "MODEL_SOURCE_UNAVAILABLE",
            "请求的模型来源不可用",
            {
              sourceKind: source.kind,
              failures
            },
            { cause: error }
          );
        }
        continue;
      }
      throwIfAborted(options.signal);
      try {
        await this.cache.put(cacheKey, loaded.bytes);
      } catch {
        // 缓存是加速层；配额或事务失败不改变已校验模型的可用性。
      }
      throwIfAborted(options.signal);
      this.currentKey = cacheKey;
      return {
        bytes: loaded.bytes,
        manifest,
        variant,
        source,
        cacheKey,
        fromCache: false,
        failures,
        timings: { modelCacheReadMs, ...loaded.timings }
      };
    }

    throw new PPDetectionError(
      "MODEL_SOURCE_UNAVAILABLE",
      "所有模型来源均不可用",
      {
        variantId: variant.id,
        failures
      },
      { cause: lastError }
    );
  }

  estimate(): Promise<CacheEstimate> {
    return this.getCacheEstimate();
  }

  getCacheEstimate(): Promise<CacheEstimate> {
    return this.cache.estimate();
  }

  async clearCurrentModelCache(): Promise<void> {
    if (!this.currentKey) return;
    await this.cache.clearCurrent(this.currentKey);
  }

  async clearAllCache(): Promise<void> {
    await this.cache.clearAll();
    this.currentKey = undefined;
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return await this.disposePromise;
    this.disposed = true;
    this.lifecycle.abort();
    this.disposePromise = (async () => {
      await Promise.all([...this.activeLoads]);
      this.currentKey = undefined;
      await this.cache.close?.();
    })();
    await this.disposePromise;
  }
}
