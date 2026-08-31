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
  ModelSource,
  RuntimeDetectionManifest
} from "./types";

declare global {
  var __PPDETECTION_SCRIPT_URL__: string | undefined;
}

export const CURRENT_SDK_VERSION = "0.1.1";

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
  PPDetectionModelSourceInfo,
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
export function probePPDetectionCapabilities(
  options: import("./runtime/capabilities").CapabilityProbeOptions = {}
) {
  return probeCapabilities(options);
}
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

function modelInfo(runtime: RuntimeDetectionManifest, variantId: string, source: ModelSource) {
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
    opset: variant.opset,
    source: {
      kind: source.kind,
      revision: source.revision,
      bytes: source.bytes,
      sha256: source.sha256
    }
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
  try {
    const loadStartedAt = now();
    options.onProgress?.({ phase: "model", status: "start" });
    let modelBytes: ArrayBuffer;
    let actualSource: ModelSource;
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
      actualSource = source;
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
      actualSource = loaded.source;
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
    const createExecutorForPlan = async (
      candidatePlan: ExecutionPlan
    ): Promise<DetectionExecutor> => {
      options.onProgress?.({ phase: "session", status: "start" });
      let bridge: WorkerBridge | undefined;
      try {
        if (candidatePlan.executionMode === "worker") {
          if (typeof Worker !== "function")
            throw new PPDetectionError("CAPABILITY_UNSUPPORTED", "当前环境不支持 Worker");
          const worker = new Worker(workerUrl(), { type: "module" });
          bridge = new WorkerBridge(worker);
          await bridge.load(modelBytes.slice(0), candidatePlan, {
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
          const activeBridge = bridge;
          options.onProgress?.({ phase: "session", status: "complete" });
          return {
            run(input, signal) {
              return activeBridge.run(
                { [input.inputName]: { data: input.data, dims: input.dims } },
                { signal }
              );
            },
            dispose: () => activeBridge.dispose()
          };
        }
        const session = await createOrtSession(modelBytes, candidatePlan, {
          ort: options.ort?.module as OrtModule | undefined,
          wasmPaths: options.ort?.wasm?.paths,
          numThreads: options.ort?.wasm?.numThreads
        });
        sessionMs = session.sessionMs;
        options.onProgress?.({ phase: "session", status: "complete" });
        return {
          run(input, signal) {
            return session.run(
              { [input.inputName]: { data: input.data, dims: input.dims } },
              { signal }
            );
          },
          dispose: () => session.dispose()
        };
      } catch (error) {
        try {
          await bridge?.dispose();
        } catch {
          // 清理失败不覆盖原始 Session 错误。
        }
        if (error instanceof PPDetectionError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new PPDetectionError(
          "SESSION_CREATE_FAILED",
          "创建 ONNX Runtime 会话失败",
          { phase: "create", causeMessage: message },
          { cause: error }
        );
      }
    };
    let selectedPlan: ExecutionPlan = plan;
    let sessionMs = 0;
    let selectedCandidateIndex = -1;
    for (const [candidateIndex, candidate] of plan.candidates.entries()) {
      const candidatePlan: ExecutionPlan = {
        ...plan,
        variantId: candidate.variantId,
        actualBackend: candidate.backend,
        actualPrecision: candidate.precision,
        executionMode: candidate.executionMode,
        candidates: [candidate]
      };
      try {
        executor = await createExecutorForPlan(candidatePlan);
        selectedPlan = candidatePlan;
        selectedCandidateIndex = candidateIndex;
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
    const runtime = {
      requestedBackend: options.backend ?? "auto",
      backend: selectedPlan.actualBackend,
      precision: selectedPlan.actualPrecision,
      mode: selectedPlan.executionMode,
      fallbacks,
      capabilities
    };
    let activeExecutor = executor;
    const fallbackExecutor: DetectionExecutor = {
      async run(input, signal) {
        try {
          return await activeExecutor.run(input, signal);
        } catch (error) {
          if (
            options.allowFallback !== true ||
            selectedCandidateIndex < 0 ||
            selectedCandidateIndex >= plan.candidates.length - 1
          ) {
            throw error;
          }
          const failedCandidate = plan.candidates[selectedCandidateIndex];
          const mapped =
            error instanceof PPDetectionError
              ? error
              : new PPDetectionError("INFERENCE_FAILED", String(error), {}, { cause: error });
          if (mapped.code === "ABORTED") throw mapped;
          const nextCandidate = plan.candidates[selectedCandidateIndex + 1];
          const nextPlan: ExecutionPlan = {
            ...plan,
            variantId: nextCandidate.variantId,
            actualBackend: nextCandidate.backend,
            actualPrecision: nextCandidate.precision,
            executionMode: nextCandidate.executionMode,
            candidates: [nextCandidate]
          };
          await activeExecutor.dispose();
          const nextExecutor = await createExecutorForPlan(nextPlan);
          activeExecutor = nextExecutor;
          selectedCandidateIndex += 1;
          selectedPlan = nextPlan;
          runtime.backend = nextPlan.actualBackend;
          runtime.precision = nextPlan.actualPrecision;
          runtime.mode = nextPlan.executionMode;
          const fallback = {
            cause: mapped.cause ?? mapped,
            code: mapped.code,
            message: mapped.message,
            precision: failedCandidate.precision,
            provider: failedCandidate.backend,
            stage: "inference",
            variantId: failedCandidate.variantId
          };
          fallbacks.push(fallback);
          options.onProgress?.({ phase: "fallback", status: "complete", fallback });
          return activeExecutor.run(input, signal);
        }
      },
      dispose: () => activeExecutor.dispose()
    };
    loadTimings = { ...loadTimings, sessionMs, totalMs: now() - loadStartedAt };
    const detector = new PPDetectionDetectorImplementation({
      capabilities,
      manifest: runtimeManifest,
      model: modelInfo(runtimeManifest, variant.id, actualSource),
      runtime,
      loadTimings,
      loadExecutor: () => Promise.resolve(fallbackExecutor),
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
