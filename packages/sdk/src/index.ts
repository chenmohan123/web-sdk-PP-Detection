import { PPDetectionError } from "./errors";
import { PPDetectionDetectorImplementation, type DetectionExecutor } from "./detection/detector";
import { parseDetectionManifest } from "./model/manifest";
import { adaptModelManifest, parseModelManifest } from "./model/public-manifest";
import { ModelManager } from "./model/model-manager";
import { verifyModelIntegrity } from "./model/integrity";
import { resolveModelSources } from "./model/source-resolver";
import { createOrtSession, type OrtModule } from "./runtime/ort-session";
import { probeCapabilities } from "./runtime/capabilities";
import { selectExecutionPlan } from "./runtime/select-plan";
import { WorkerBridge } from "./runtime/worker-bridge";
import type { ExecutionPlan } from "./runtime/select-plan";
import type {
  Backend,
  CreatePPDetectionOptions,
  DetectionManifest,
  PPDetectionModel,
  RuntimeDetectionManifest
} from "./types";

declare global {
  var __PPDETECTION_SCRIPT_URL__: string | undefined;
}

export const CURRENT_SDK_VERSION = "0.1.0";

export type {
  Backend,
  BackendPreference,
  CreatePPDetectionOptions,
  Detection,
  DetectionBox,
  DetectionCapabilities,
  DetectionManifest,
  DetectionModelVariant,
  DetectionPoint,
  DetectionPostprocessing,
  DetectionPreprocessing,
  DetectionTimings,
  DetectOptions,
  ExecutionMode,
  ModelBackend,
  ModelInfo,
  ModelManifest,
  ModelManifestMetadata,
  ModelManifestSource,
  ModelManifestVariant,
  ModelPrecision,
  ModelSource,
  ModelSourceKind,
  ModelVariant,
  PPDetectionFallback,
  PPDetectionLoadTimings,
  PPDetectionModel,
  PPDetectionModelInfo,
  PPDetectionProgressEvent,
  PPDetectionResult,
  PPDetectionRuntimeInfo,
  Precision,
  RuntimeDetectionManifest,
  RuntimeInfo,
  TensorContract,
  TimingBreakdown
} from "./types";
export type { ImageSource, ImageRaster, DecodedImage } from "./input/image-source";
export type { PPDetectionDetector } from "./detection/detector";
export { PPDetectionError } from "./errors";
export type { PPDetectionErrorCode } from "./errors";
export { probeCapabilities } from "./runtime/capabilities";
export type { CapabilityProbeOptions } from "./runtime/capabilities";
export { selectExecutionPlan } from "./runtime/select-plan";
export type {
  ExecutionCandidate,
  ExecutionPlan,
  SelectExecutionOptions
} from "./runtime/select-plan";
export { createOrtSession } from "./runtime/ort-session";
export type { CreateOrtSessionOptions, OrtModule, OrtSessionHandle } from "./runtime/ort-session";
export type { WorkerOrtOptions, WorkerRequest, WorkerResponse } from "./runtime/protocol";
export { parseDetectionManifest } from "./model/manifest";
export { parseModelManifest, adaptModelManifest } from "./model/public-manifest";
export { resolveModelAsset } from "./model/source-resolver";
export type {
  ModelSourceSelection,
  ResolveModelAssetSelection,
  ResolvedModelAsset
} from "./model/source-resolver";
export { loadModelAsset } from "./model/download";
export type {
  LoadModelAssetOptions,
  ModelBytes,
  ModelDownloadProgress,
  ModelFetcher
} from "./model/download";
export { ModelManager } from "./model/model-manager";
export type {
  LoadedManagedModel,
  LoadManagedModelOptions,
  ModelManagerOptions,
  ModelSourceFailure
} from "./model/model-manager";
export { MemoryModelCache } from "./cache/memory-cache";
export { IndexedDBModelCache } from "./cache/indexeddb-cache";
export type { IndexedDBModelCacheOptions } from "./cache/indexeddb-cache";
export type { CacheEstimate, ModelCache } from "./cache/model-cache";

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function isRuntimeManifest(value: unknown): value is RuntimeDetectionManifest {
  if (typeof value !== "object" || value === null || !("postprocessing" in value)) return false;
  const variants = (value as { variants?: unknown }).variants;
  return (
    Array.isArray(variants) &&
    (variants[0] as { sources?: unknown } | undefined)?.sources !== undefined
  );
}

function isModelData(value: PPDetectionModel): value is Readonly<{
  data: ArrayBuffer;
  manifest: RuntimeDetectionManifest | import("./types").ModelManifest;
}> {
  return typeof value === "object" && value !== null && "data" in value && "manifest" in value;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new PPDetectionError("ABORTED", "模型清单下载已取消", { url }, { cause: error });
    }
    throw new PPDetectionError(
      "MODEL_SOURCE_UNAVAILABLE",
      "模型清单下载失败",
      { url },
      { cause: error }
    );
  }
  if (signal?.aborted) throw new PPDetectionError("ABORTED", "模型清单下载已取消", { url });
  if (!response.ok)
    throw new PPDetectionError("MODEL_SOURCE_UNAVAILABLE", "模型清单返回非成功状态", {
      url,
      status: response.status
    });
  try {
    const value: unknown = await response.json();
    if (signal?.aborted) throw new PPDetectionError("ABORTED", "模型清单下载已取消", { url });
    return value;
  } catch (error) {
    if (error instanceof PPDetectionError) throw error;
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new PPDetectionError("ABORTED", "模型清单下载已取消", { url }, { cause: error });
    }
    throw new PPDetectionError(
      "INVALID_MANIFEST",
      "模型清单 JSON 无法解析",
      { url },
      { cause: error }
    );
  }
}

function asRuntimeManifest(value: unknown): RuntimeDetectionManifest {
  return isRuntimeManifest(value)
    ? parseDetectionManifest(value)
    : adaptModelManifest(parseModelManifest(value));
}

function simpleManifest(runtime: RuntimeDetectionManifest): DetectionManifest {
  return {
    id: runtime.model.id,
    version: runtime.model.version,
    variants: runtime.variants.map((variant) => ({
      id: variant.id,
      precision: variant.precision,
      quantization: variant.quantization,
      backends: variant.backends,
      status: variant.status
    }))
  };
}

function modelInfo(runtime: RuntimeDetectionManifest, variantId: string) {
  const variant = runtime.variants.find((candidate) => candidate.id === variantId);
  if (!variant)
    throw new PPDetectionError("MODEL_INCOMPATIBLE", "请求的模型变体不存在", { variantId });
  return {
    id: runtime.model.id,
    version: runtime.model.version,
    variantId: variant.id,
    precision: variant.precision,
    bytes: variant.bytes,
    parameterCount: variant.parameterCount,
    opset: variant.opset
  };
}

function workerUrl(): URL {
  const scriptUrl = globalThis.__PPDETECTION_SCRIPT_URL__;
  if (scriptUrl) return new URL("./inference.worker.js", scriptUrl);
  return new URL("./inference.worker.js", import.meta.url);
}

export async function createPPDetection(
  options: CreatePPDetectionOptions = {}
): Promise<PPDetectionDetectorImplementation> {
  if (options.model === undefined && options.manifest === undefined)
    throw new PPDetectionError("INVALID_MANIFEST", "创建 PPDetection 实例需要 manifest 或 model");
  const capabilities = probeCapabilities();
  options.onProgress?.({ phase: "capabilities", status: "complete" });
  const requestedModel = options.model ?? options.manifest!;
  let runtimeManifest: RuntimeDetectionManifest;
  let memoryData: ArrayBuffer | undefined;
  options.onProgress?.({ phase: "manifest", status: "start" });
  if (typeof requestedModel === "string") {
    runtimeManifest = asRuntimeManifest(await fetchJson(requestedModel, options.signal));
  } else if (isModelData(requestedModel)) {
    runtimeManifest = asRuntimeManifest(requestedModel.manifest);
    memoryData = requestedModel.data;
  } else {
    runtimeManifest = asRuntimeManifest(requestedModel);
  }
  options.onProgress?.({ phase: "manifest", status: "complete" });

  const plan = selectExecutionPlan(
    {
      backend: options.backend,
      precision: options.precision === "auto" ? undefined : options.precision,
      executionMode: options.executionMode,
      allowFallback: options.allowFallback
    },
    capabilities,
    simpleManifest(runtimeManifest)
  );
  const modelManager = new ModelManager({
    cache: options.cache === false ? false : options.cache === "memory" ? "memory" : undefined
  });
  let executor: DetectionExecutor | undefined;
  let activeBridge: WorkerBridge | undefined;
  try {
    const loadStartedAt = now();
    options.onProgress?.({ phase: "model", status: "start" });
    let modelBytes: ArrayBuffer;
    let variant = runtimeManifest.variants.find((candidate) => candidate.id === plan.variantId)!;
    let loadTimings: {
      modelDownloadMs?: number;
      modelCacheReadMs?: number;
      integrityMs?: number;
      sessionMs: number;
      totalMs: number;
    };
    if (memoryData !== undefined) {
      const [source] = resolveModelSources(variant, options.source ?? "auto");
      if (!source)
        throw new PPDetectionError("MODEL_SOURCE_UNAVAILABLE", "模型变体没有可用来源", {
          variantId: variant.id
        });
      await verifyModelIntegrity(memoryData, source, options.signal);
      modelBytes = memoryData;
      loadTimings = { sessionMs: 0, totalMs: now() - loadStartedAt, integrityMs: 0 };
    } else {
      const loaded = await modelManager.load({
        manifest: runtimeManifest,
        variantId: plan.variantId,
        sourceKind: options.source ?? "auto",
        signal: options.signal,
        onProgress: (progress) =>
          options.onProgress?.({ phase: "model", status: "progress", ...progress })
      });
      modelBytes = loaded.bytes;
      variant = loaded.variant;
      loadTimings = { ...loaded.timings, sessionMs: 0, totalMs: now() - loadStartedAt };
    }
    options.onProgress?.({ phase: "model", status: "complete" });
    const fallbacks: Array<{
      cause: unknown;
      code: string;
      message: string;
      precision: typeof plan.actualPrecision;
      provider: Backend;
      stage: string;
      variantId: string;
    }> = [];
    let selectedPlan: ExecutionPlan = plan;
    let sessionMs = 0;
    for (const candidate of plan.candidates) {
      const candidatePlan: ExecutionPlan = {
        ...plan,
        variantId: candidate.variantId,
        actualBackend: candidate.backend,
        actualPrecision: candidate.precision,
        executionMode: candidate.executionMode,
        candidates: [candidate]
      };
      options.onProgress?.({ phase: "session", status: "start" });
      try {
        if (candidate.executionMode === "worker") {
          if (typeof Worker !== "function")
            throw new PPDetectionError("CAPABILITY_UNSUPPORTED", "当前环境不支持 Worker");
          const worker = new Worker(workerUrl(), {
            type: "module"
          });
          const bridge = new WorkerBridge(worker);
          activeBridge = bridge;
          const workerModelBytes = modelBytes.slice(0);
          await bridge.load(workerModelBytes, candidatePlan, {
            onProgress: (event) =>
              options.onProgress?.({
                phase: "session",
                status: event.status as "start" | "progress" | "complete"
              }),
            ort: {
              wasmPaths: options.ort?.wasm?.paths,
              numThreads: options.ort?.wasm?.numThreads
            }
          });
          executor = {
            run(input, signal) {
              return bridge.run(
                { [input.inputName]: { data: input.data, dims: input.dims } },
                { signal }
              );
            },
            dispose: () => bridge.dispose()
          };
          activeBridge = undefined;
        } else {
          const session = await createOrtSession(modelBytes, candidatePlan, {
            ort: options.ort?.module as OrtModule | undefined,
            wasmPaths: options.ort?.wasm?.paths,
            numThreads: options.ort?.wasm?.numThreads
          });
          sessionMs = session.sessionMs;
          executor = {
            run(input, signal) {
              return session.run(
                { [input.inputName]: { data: input.data, dims: input.dims } },
                { signal }
              );
            },
            dispose: () => session.dispose()
          };
        }
        selectedPlan = candidatePlan;
        options.onProgress?.({ phase: "session", status: "complete" });
        break;
      } catch (error) {
        const mapped =
          error instanceof PPDetectionError
            ? error
            : new PPDetectionError("SESSION_CREATE_FAILED", String(error));
        const hasNext = options.allowFallback === true && candidate !== plan.candidates.at(-1);
        try {
          await executor?.dispose();
        } catch {
          // 清理失败不覆盖原始 Session 错误。
        }
        executor = undefined;
        try {
          await activeBridge?.dispose();
        } catch {
          // 清理失败不覆盖原始 Worker 错误。
        }
        activeBridge = undefined;
        if (!hasNext) {
          throw mapped;
        }
        const fallback = {
          cause: mapped.cause ?? mapped,
          code: mapped.code,
          message: mapped.message,
          precision: candidate.precision,
          provider: candidate.backend,
          stage: "session",
          variantId: candidate.variantId
        };
        fallbacks.push(fallback);
        options.onProgress?.({ phase: "fallback", status: "complete", fallback });
      }
    }
    if (!executor) throw new PPDetectionError("SESSION_CREATE_FAILED", "无法创建检测 Session");
    const loadedExecutor = executor;
    loadTimings = { ...loadTimings, sessionMs, totalMs: now() - loadStartedAt };
    const detector = new PPDetectionDetectorImplementation({
      capabilities,
      manifest: runtimeManifest,
      model: modelInfo(runtimeManifest, variant.id),
      runtime: {
        requestedBackend: options.backend ?? "auto",
        backend: selectedPlan.actualBackend,
        precision: selectedPlan.actualPrecision,
        mode: selectedPlan.executionMode,
        fallbacks,
        capabilities
      },
      loadTimings,
      loadExecutor: () => Promise.resolve(loadedExecutor),
      onProgress: options.onProgress,
      clearCurrentModelCache: () => modelManager.clearCurrentModelCache(),
      clearAllCache: () => modelManager.clearAllCache(),
      getCacheEstimate: () => modelManager.getCacheEstimate(),
      disposeResources: () => modelManager.dispose()
    });
    await detector.load({ signal: options.signal });
    options.onProgress?.({ phase: "ready", status: "complete" });
    return detector;
  } catch (error) {
    try {
      await executor?.dispose();
    } catch {
      // 清理失败不覆盖初始化错误。
    }
    try {
      await activeBridge?.dispose();
    } catch {
      // 清理失败不覆盖初始化错误。
    }
    try {
      await modelManager.dispose();
    } catch {
      // 清理失败不覆盖初始化错误。
    }
    throw error;
  }
}

export async function clearModelCache(): Promise<void> {
  const manager = new ModelManager();
  await manager.clearAllCache();
  await manager.dispose();
}
