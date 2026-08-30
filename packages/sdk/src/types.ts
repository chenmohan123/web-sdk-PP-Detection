export type Backend = "wasm" | "webgpu";
export type BackendPreference = Backend | "auto";
export type ExecutionMode = "main" | "worker";
export type Precision = "fp32" | "fp16" | "int8" | "int4" | "fp8";
export type ModelSourceKind = "git-lfs" | "huggingface" | "modelscope" | "custom";

export interface ModelIdentity {
  readonly id: string;
  readonly version: string;
}

export interface ModelSource {
  readonly kind: ModelSourceKind;
  readonly repository: string;
  readonly revision: string;
  readonly path: string;
  readonly downloadUrl: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ModelVariant {
  readonly id: string;
  readonly precision: Precision;
  readonly quantization?: string | null;
  readonly backends: readonly Backend[];
  readonly status?: "stable" | "labs" | "blocked";
}

export interface DetectionModelVariant extends ModelVariant {
  readonly opset: number;
  readonly bytes: number;
  readonly parameterCount: number | null;
  readonly sources: readonly ModelSource[];
}

export interface TensorContract {
  readonly name: string;
  readonly shape: readonly number[];
  readonly dtype: string;
}

export interface DetectionPreprocessing {
  readonly size: { readonly width: number; readonly height: number };
  readonly rescaleFactor: number;
  readonly resizeMode?: "letterbox" | "stretch";
  readonly interpolation?: "bilinear" | "bicubic";
  readonly mean?: readonly number[];
  readonly std?: readonly number[];
  readonly doResize?: boolean;
  readonly doRescale?: boolean;
  readonly doNormalize?: boolean;
}

export interface DetectionPostprocessing {
  readonly type: "nms";
  readonly scoreThreshold: number;
  readonly iouThreshold: number;
  readonly matrixCoordinates?: "pixels" | "normalized";
  readonly queryCoordinates?: "pixels" | "normalized";
  readonly queryBoxFormat?: "cxcywh" | "xyxy";
}

export interface RuntimeDetectionManifest {
  readonly schemaVersion: 1;
  readonly model: ModelIdentity;
  readonly input: TensorContract;
  readonly outputs: readonly TensorContract[];
  readonly preprocessing: DetectionPreprocessing;
  readonly postprocessing: DetectionPostprocessing;
  readonly labels: readonly string[];
  readonly variants: readonly DetectionModelVariant[];
}

export interface DetectionManifest {
  readonly id: string;
  readonly version: string;
  readonly variants?: readonly ModelVariant[];
}

export type PPDetectionManifest = DetectionManifest;

export type ModelBackend = Backend;
export type ModelPrecision = Precision;

export interface ModelManifestMetadata {
  readonly architecture: string;
  readonly id: string;
  readonly modelType: string;
  readonly parameterCount: number | null;
  readonly version: string;
}

export interface ModelManifestSource {
  readonly files: Readonly<Record<string, string>>;
  readonly license: string;
  readonly name: string;
  readonly url: string;
}

export interface ModelManifestVariant {
  readonly backendCompatibility: readonly ModelBackend[];
  readonly bytes: number;
  readonly filename: string;
  readonly id: string;
  readonly opset: number;
  readonly precision: ModelPrecision;
  readonly quantization: string | null;
  readonly sha256: string;
  readonly url: string;
  readonly validation: Readonly<{ included: boolean; pass: boolean; report: string }>;
}

export interface ModelManifest {
  readonly input: TensorContract;
  readonly labels: readonly string[];
  readonly minSdkVersion: string;
  readonly model: ModelManifestMetadata;
  readonly outputs: readonly TensorContract[];
  readonly preprocessing: Readonly<{
    doNormalize: boolean;
    doRescale: boolean;
    doResize: boolean;
    readonly resizeMode?: "letterbox" | "stretch";
    readonly interpolation?: "bilinear" | "bicubic";
    imageMean: readonly [number, number, number];
    imageStd: readonly [number, number, number];
    resample: 2 | 3;
    rescaleFactor: number;
    size: Readonly<{ height: number; width: number }>;
  }>;
  readonly schemaVersion: 1;
  readonly source: ModelManifestSource;
  readonly variantPriority: readonly string[];
  readonly variants: readonly ModelManifestVariant[];
}

export type PPDetectionModel =
  | string
  | RuntimeDetectionManifest
  | ModelManifest
  | Readonly<{
      data: ArrayBuffer;
      manifest: RuntimeDetectionManifest | ModelManifest;
    }>;

export type PPDetectionProgressPhase =
  | "capabilities"
  | "manifest"
  | "model"
  | "session"
  | "fallback"
  | "ready"
  | "preprocess"
  | "inference"
  | "postprocess";

export interface PPDetectionProgressEvent {
  readonly phase: PPDetectionProgressPhase;
  readonly status: "start" | "progress" | "complete";
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly fallback?: PPDetectionFallback;
}

export interface CreatePPDetectionOptions {
  readonly allowFallback?: boolean;
  readonly backend?: BackendPreference;
  readonly cache?: boolean | "memory" | "indexeddb";
  readonly executionMode?: ExecutionMode;
  readonly manifest?: RuntimeDetectionManifest;
  readonly model?: PPDetectionModel;
  readonly onProgress?: (event: PPDetectionProgressEvent) => void;
  readonly ort?: Readonly<{
    module?: unknown;
    wasm?: Readonly<{ paths?: string; numThreads?: number }>;
  }>;
  readonly precision?: Precision | "auto";
  readonly signal?: AbortSignal;
  readonly source?: ModelSourceKind | "auto";
}

export interface DetectionCapabilities {
  readonly webgpu: boolean;
  readonly worker: boolean;
  readonly offscreenCanvas: boolean;
  readonly wasmSimd: boolean;
  readonly wasmThreads: boolean;
}

export interface RuntimeInfo {
  readonly requestedBackend: BackendPreference;
  readonly actualBackend: Backend;
  readonly requestedPrecision: Precision;
  readonly actualPrecision: Precision;
  readonly executionMode: ExecutionMode;
}

export interface TimingBreakdown {
  readonly modelDownloadMs?: number;
  readonly modelCacheReadMs?: number;
  readonly integrityMs?: number;
  readonly sessionMs?: number;
  readonly inferenceMs?: number;
  readonly totalMs?: number;
}

export interface DetectionTimings {
  readonly decodeMs: number;
  readonly preprocessMs: number;
  readonly inferenceMs: number;
  readonly postprocessMs: number;
  readonly totalMs: number;
}

export interface DetectionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export interface DetectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface Detection {
  readonly index: number;
  readonly classId: number;
  readonly labelId: number;
  readonly label: string;
  readonly score: number;
  readonly box: DetectionBox;
  readonly polygon: readonly DetectionPoint[];
}

export interface DetectOptions {
  readonly threshold?: number;
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly signal?: AbortSignal;
  readonly timestampMs?: number;
  readonly metadata?: unknown;
}

export interface PPDetectionFallback {
  readonly cause: unknown;
  readonly code: string;
  readonly message: string;
  readonly precision: Precision;
  readonly provider: Backend;
  readonly stage: string;
  readonly variantId: string;
}

export interface PPDetectionRuntimeInfo {
  readonly requestedBackend: BackendPreference;
  readonly backend: Backend;
  readonly precision: Precision;
  readonly mode: ExecutionMode;
  readonly fallbacks: readonly PPDetectionFallback[];
  readonly capabilities: DetectionCapabilities;
}

export interface PPDetectionModelInfo {
  readonly id: string;
  readonly version: string;
  readonly variantId: string;
  readonly precision: Precision;
  readonly bytes: number;
  readonly parameterCount: number | null;
  readonly opset: number;
  readonly source: PPDetectionModelSourceInfo;
}

export interface PPDetectionModelSourceInfo {
  readonly kind: ModelSourceKind;
  readonly revision: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PPDetectionLoadTimings {
  readonly modelDownloadMs?: number;
  readonly modelCacheReadMs?: number;
  readonly integrityMs?: number;
  readonly sessionMs: number;
  readonly totalMs: number;
}

export interface PPDetectionResult {
  readonly detections: readonly Detection[];
  readonly image: Readonly<{
    input: Readonly<{ width: number; height: number }>;
    original: Readonly<{ width: number; height: number }>;
  }>;
  readonly model: PPDetectionModelInfo;
  readonly runtime: PPDetectionRuntimeInfo;
  readonly timings: DetectionTimings;
  readonly frame?: Readonly<{ timestampMs?: number; metadata?: unknown }>;
}

export interface ModelInfo {
  readonly id: string;
  readonly version: string;
  readonly variantId: string;
  readonly precision: Precision;
  readonly bytes?: number;
  readonly parameterCount?: number | null;
}
