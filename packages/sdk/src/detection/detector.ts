import { PPDetectionError } from "../errors";
import { decodeImageSource, type DecodeImageEnvironment } from "../input/decode-image";
import type { ImageSource } from "../input/image-source";
import type {
  DetectOptions,
  Detection,
  DetectionCapabilities,
  PPDetectionLoadTimings,
  PPDetectionModelInfo,
  PPDetectionProgressEvent,
  PPDetectionResult,
  PPDetectionRuntimeInfo,
  RuntimeDetectionManifest
} from "../types";
import { decodeDetectionOutputs } from "./decode-output";
import { preprocessImage } from "./preprocess";
import {
  cropImageTile,
  smallObjectTiles,
  projectTileDetection,
  mergeSmallObjectDetections,
  type ImageTile
} from "./small-objects";

export interface InferenceInput {
  readonly inputName: string;
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

export interface DetectionExecutor {
  run(input: InferenceInput, signal?: AbortSignal): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface PPDetectionDetectorOptions {
  readonly capabilities: DetectionCapabilities;
  readonly manifest: RuntimeDetectionManifest;
  readonly model: PPDetectionModelInfo;
  readonly runtime: PPDetectionRuntimeInfo;
  readonly loadTimings: PPDetectionLoadTimings;
  readonly loadExecutor: (signal?: AbortSignal) => Promise<DetectionExecutor>;
  readonly decodeEnvironment?: Omit<DecodeImageEnvironment, "signal">;
  readonly now?: () => number;
  readonly onProgress?: (event: PPDetectionProgressEvent) => void;
  readonly clearCurrentModelCache?: () => Promise<void>;
  readonly clearAllCache?: () => Promise<void>;
  readonly getCacheEstimate?: () => Promise<{ bytes: number; entries: number }>;
  readonly disposeResources?: () => Promise<void> | void;
}

function nowDefault(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function elapsed(clock: () => number, startedAt: number): number {
  return Math.max(0, clock() - startedAt);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PPDetectionError("ABORTED", "检测已取消", { reason: signal.reason });
  }
}

function validateThreshold(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new PPDetectionError("INVALID_INPUT", `${path} 必须是 0 到 1 的有限数值`, {
      path,
      value
    });
  }
}

function validateDetectOptions(labels: readonly string[], options: DetectOptions): void {
  if (
    options.smallObjectEnhancement !== undefined &&
    typeof options.smallObjectEnhancement !== "boolean"
  ) {
    throw new PPDetectionError("INVALID_INPUT", "smallObjectEnhancement 必须是布尔值");
  }
  if (options.threshold !== undefined) validateThreshold(options.threshold, "threshold");
  if (options.classThresholds === undefined) return;
  for (const [label, value] of Object.entries(options.classThresholds)) {
    if (!labels.includes(label)) {
      throw new PPDetectionError("INVALID_INPUT", `classThresholds 包含未知类别 ${label}`, {
        label
      });
    }
    validateThreshold(value, `classThresholds.${label}`);
  }
}

export class PPDetectionDetectorImplementation {
  readonly capabilities: DetectionCapabilities;
  readonly manifest: RuntimeDetectionManifest;
  readonly model: PPDetectionModelInfo;
  readonly runtime: PPDetectionRuntimeInfo;
  readonly loadTimings: PPDetectionLoadTimings;
  private readonly clock: () => number;
  private executor?: DetectionExecutor;
  private loadPromise?: Promise<void>;
  private disposePromise?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: PPDetectionDetectorOptions) {
    this.capabilities = options.capabilities;
    this.manifest = options.manifest;
    this.model = options.model;
    this.runtime = options.runtime;
    this.loadTimings = options.loadTimings;
    this.clock = options.now ?? nowDefault;
  }

  async load(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.disposed) throw new PPDetectionError("DISPOSED", "检测器已释放");
    throwIfAborted(options.signal);
    if (this.executor) return;
    this.loadPromise ??= this.options.loadExecutor(options.signal).then(async (executor) => {
      if (this.disposed) {
        await executor.dispose();
        throw new PPDetectionError("DISPOSED", "检测器已释放");
      }
      this.executor = executor;
    });
    try {
      await this.loadPromise;
    } catch (error) {
      this.loadPromise = undefined;
      throw error;
    }
  }

  detect(input: ImageSource, options: DetectOptions = {}): Promise<PPDetectionResult> {
    if (this.disposed) return Promise.reject(new PPDetectionError("DISPOSED", "检测器已释放"));
    if (!this.executor) {
      return Promise.reject(new PPDetectionError("SESSION_CREATE_FAILED", "检测器尚未加载"));
    }
    try {
      validateDetectOptions(this.manifest.labels, options);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new PPDetectionError("INVALID_INPUT", String(error))
      );
    }
    const operation = this.queue.then(() => this.detectOnce(input, options));
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  getCacheEstimate(): Promise<{ bytes: number; entries: number }> {
    return this.options.getCacheEstimate?.() ?? Promise.resolve({ bytes: 0, entries: 0 });
  }

  clearCurrentModelCache(): Promise<void> {
    return this.options.clearCurrentModelCache?.() ?? Promise.resolve();
  }

  clearAllCache(): Promise<void> {
    return this.options.clearAllCache?.() ?? Promise.resolve();
  }

  clearModelCache(): Promise<void> {
    return this.clearCurrentModelCache();
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return await this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      await this.queue;
      await this.executor?.dispose();
      this.executor = undefined;
      await this.options.disposeResources?.();
    })();
    await this.disposePromise;
  }

  private async detectOnce(input: ImageSource, options: DetectOptions): Promise<PPDetectionResult> {
    if (this.disposed) throw new PPDetectionError("DISPOSED", "检测器已释放");
    const executor = this.executor;
    if (!executor) throw new PPDetectionError("SESSION_CREATE_FAILED", "检测器尚未加载");
    throwIfAborted(options.signal);
    const totalStartedAt = this.clock();

    const decoded = await decodeImageSource(input, {
      ...this.options.decodeEnvironment,
      signal: options.signal,
      now: this.clock,
      ...(options.smallObjectEnhancement ? { maxPixels: 16_777_216 } : {})
    });
    throwIfAborted(options.signal);

    const checkActive = (): void => {
      throwIfAborted(options.signal);
      if (this.disposed) throw new PPDetectionError("DISPOSED", "检测器已释放");
    };
    const tiles = options.smallObjectEnhancement
      ? smallObjectTiles(decoded.width, decoded.height)
      : [];
    const passes = 1 + tiles.length;
    let preprocessMs = 0;
    let inferenceMs = 0;
    let postprocessMs = 0;
    let whole: Detection[] = [];
    const tileResults: { tile: ImageTile; detections: Detection[] }[] = [];
    const threshold = options.threshold ?? this.manifest.postprocessing.scoreThreshold;
    // 保留弱框参与合并；更低的显式阈值仍可输出，不被内部 0.001 门槛截断。
    const candidateThreshold = Math.min(
      0.001,
      threshold,
      ...Object.values(options.classThresholds ?? {})
    );
    options.onProgress?.({ completed: 0, total: passes });
    for (let pass = 0; pass < passes; pass++) {
      // 给主线程绘制进度和响应取消的机会；一次只创建一个切片缓冲区。
      if (options.smallObjectEnhancement)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      checkActive();
      this.options.onProgress?.({ phase: "preprocess", status: "start" });
      checkActive();
      const preprocessStartedAt = this.clock();
      const tile = pass === 0 ? undefined : tiles[pass - 1];
      const preprocessed = preprocessImage(
        tile ? cropImageTile(decoded, tile) : decoded,
        this.manifest.preprocessing
      );
      preprocessMs += elapsed(this.clock, preprocessStartedAt);
      this.options.onProgress?.({ phase: "preprocess", status: "complete" });
      checkActive();

      this.options.onProgress?.({ phase: "inference", status: "start" });
      checkActive();
      const inferenceStartedAt = this.clock();
      const outputs = await executor.run(
        {
          inputName: this.manifest.input.name,
          data: preprocessed.data,
          dims: preprocessed.dims
        },
        options.signal
      );
      inferenceMs += elapsed(this.clock, inferenceStartedAt);
      checkActive();
      this.options.onProgress?.({ phase: "inference", status: "complete" });

      this.options.onProgress?.({ phase: "postprocess", status: "start" });
      checkActive();
      const postprocessStartedAt = this.clock();
      const detections = decodeDetectionOutputs(outputs, {
        labels: this.manifest.labels,
        scoreThreshold: options.smallObjectEnhancement ? candidateThreshold : threshold,
        classThresholds: options.smallObjectEnhancement ? undefined : options.classThresholds,
        iouThreshold: this.manifest.postprocessing.iouThreshold,
        transform: preprocessed.transform,
        outputs: this.manifest.outputs,
        matrixCoordinates: this.manifest.postprocessing.matrixCoordinates,
        queryCoordinates: this.manifest.postprocessing.queryCoordinates,
        queryBoxFormat: this.manifest.postprocessing.queryBoxFormat
      });
      if (tile)
        tileResults.push({
          tile,
          detections: detections.map((detection) => projectTileDetection(detection, tile))
        });
      else whole = detections;
      postprocessMs += elapsed(this.clock, postprocessStartedAt);
      this.options.onProgress?.({ phase: "postprocess", status: "complete" });
      checkActive();
      // 最后一次进度在合并完成后发出，保证完成代表整次检测成功。
      if (pass + 1 < passes) options.onProgress?.({ completed: pass + 1, total: passes });
    }
    checkActive();
    const mergeStartedAt = this.clock();
    const detections = options.smallObjectEnhancement
      ? mergeSmallObjectDetections(whole, tileResults, decoded.width, decoded.height)
          .filter(
            (detection) =>
              detection.score >= (options.classThresholds?.[detection.label] ?? threshold)
          )
          .map((detection, index) => ({ ...detection, index }))
      : whole;
    if (options.smallObjectEnhancement) postprocessMs += elapsed(this.clock, mergeStartedAt);
    options.onProgress?.({ completed: passes, total: passes });
    checkActive();

    return {
      ...(options.smallObjectEnhancement ? { smallObjectEnhancement: { passes } } : {}),
      detections,
      image: {
        input: this.manifest.preprocessing.size,
        original: { width: decoded.width, height: decoded.height }
      },
      model: this.model,
      runtime: {
        ...this.runtime,
        fallbacks: this.runtime.fallbacks.map((fallback) => ({ ...fallback })),
        ...(this.runtime.environment ? { environment: { ...this.runtime.environment } } : {})
      },
      timings: {
        decodeMs: decoded.decodeMs,
        preprocessMs,
        inferenceMs,
        postprocessMs,
        totalMs: elapsed(this.clock, totalStartedAt)
      },
      ...(options.timestampMs === undefined && options.metadata === undefined
        ? {}
        : { frame: { timestampMs: options.timestampMs, metadata: options.metadata } })
    };
  }
}

export type PPDetectionDetector = PPDetectionDetectorImplementation;
