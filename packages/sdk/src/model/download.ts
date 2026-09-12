import { PPDetectionError } from "../errors";
import type { ModelDownloadOptions, TimingBreakdown } from "../types";
import { verifyModelIntegrity } from "./integrity";
import type { ResolvedModelAsset } from "./source-resolver";

export type ModelFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ModelDownloadProgress {
  readonly loadedBytes: number;
  readonly totalBytes?: number;
  readonly attempt?: number;
  readonly maxAttempts?: number;
}

export interface LoadModelAssetOptions {
  readonly fetcher?: ModelFetcher;
  readonly signal?: AbortSignal;
  readonly download?: ModelDownloadOptions;
  readonly onProgress?: (progress: ModelDownloadProgress) => void;
}

export interface ModelBytes {
  readonly bytes: ArrayBuffer;
  readonly timings: Pick<TimingBreakdown, "modelDownloadMs" | "integrityMs">;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

class RetryableDownloadError extends PPDetectionError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}, cause?: unknown) {
    super("MODEL_DOWNLOAD_FAILED", message, details, { cause });
  }
}

export function resolveDownloadOptions(
  options: ModelDownloadOptions = {}
): Required<ModelDownloadOptions> {
  if (options === null || typeof options !== "object")
    throw new PPDetectionError("INVALID_INPUT", "下载配置必须是对象");
  const resolved = {
    timeoutMs: options.timeoutMs === undefined ? 180_000 : options.timeoutMs,
    idleTimeoutMs: options.idleTimeoutMs === undefined ? 30_000 : options.idleTimeoutMs,
    maxRetries: options.maxRetries === undefined ? 2 : options.maxRetries
  };
  for (const [key, value] of Object.entries(resolved)) {
    const maximum = key === "maxRetries" ? 5 : 2_147_483_647;
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
      throw new PPDetectionError("INVALID_INPUT", "下载参数必须为允许范围内的安全整数", {
        parameter: key,
        value,
        maximum
      });
  }
  return resolved;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function aborted(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PPDetectionError("ABORTED", "模型下载已取消");
}

function contentLength(response: Response, expectedBytes: number): number {
  const raw = response.headers.get("content-length");
  if (raw === null) return expectedBytes;
  const actual = Number(raw);
  if (!Number.isSafeInteger(actual) || actual < 0 || actual !== expectedBytes) {
    throw new PPDetectionError("MODEL_INTEGRITY_FAILED", "响应 Content-Length 与清单不一致", {
      contentLength: raw,
      expectedBytes
    });
  }
  return actual;
}

function validatePartialResponse(response: Response, expectedBytes: number): void {
  if (response.status !== 206) return;
  const raw = response.headers.get("content-range");
  const match = raw?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  if (
    !match ||
    Number(match[1]) !== 0 ||
    Number(match[2]) !== expectedBytes - 1 ||
    Number(match[3]) !== expectedBytes
  ) {
    throw new PPDetectionError("MODEL_DOWNLOAD_FAILED", "206 响应未覆盖完整模型范围", {
      contentRange: raw,
      expectedContentRange: `bytes 0-${expectedBytes - 1}/${expectedBytes}`
    });
  }
}

function cancelQuietly(cancel: () => unknown): void {
  try {
    // 自定义流的取消可能永不完成；只接收拒绝，不延迟调用方结束。
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // 清理失败不能覆盖下载原始错误。
  }
}

async function downloadAttempt(
  asset: ResolvedModelAsset,
  fetcher: ModelFetcher,
  options: LoadModelAssetOptions,
  policy: Required<ModelDownloadOptions>,
  attempt: number
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let active = true;
  let cancelledBody = false;
  let stopError: PPDetectionError | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop!: (reason: PPDetectionError) => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  // 即使进度回调同步抛错，也不会留下未处理的取消拒绝。
  void stopped.catch(() => undefined);
  const cancelBody = (reason?: unknown) => {
    if (cancelledBody || (!reader && !response?.body)) return;
    cancelledBody = true;
    if (reader) cancelQuietly(() => reader!.cancel(reason));
    else cancelQuietly(() => response!.body!.cancel(reason));
  };
  const stop = (error: PPDetectionError) => {
    if (!active || stopError) return;
    stopError = error;
    rejectStop(error);
    controller.abort();
    cancelBody(error);
  };
  const abort = () => stop(new PPDetectionError("ABORTED", "模型下载已取消"));
  const renewIdle = () => {
    clearTimeout(idleTimer);
    if (policy.idleTimeoutMs > 0)
      idleTimer = setTimeout(
        () =>
          stop(
            new RetryableDownloadError("模型下载长时间没有新增字节", {
              idleTimeoutMs: policy.idleTimeoutMs
            })
          ),
        policy.idleTimeoutMs
      );
  };
  const checkActive = () => {
    if (stopError) throw stopError;
    throwIfAborted(options.signal);
  };
  const network = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      checkActive();
      const value = await Promise.race([operation(), stopped]);
      checkActive();
      return value;
    } catch (error) {
      if (stopError) throw stopError;
      if (aborted(error, options.signal))
        throw new PPDetectionError("ABORTED", "模型下载已取消", {}, { cause: error });
      if (error instanceof PPDetectionError) throw error;
      throw new RetryableDownloadError(
        "模型下载请求或响应读取失败",
        { sourceKind: asset.source.kind, downloadUrl: asset.source.downloadUrl },
        error
      );
    }
  };
  const report = (loadedBytes: number) => {
    checkActive();
    options.onProgress?.({
      loadedBytes,
      totalBytes: asset.source.bytes,
      attempt,
      maxAttempts: policy.maxRetries + 1
    });
    checkActive();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    throwIfAborted(options.signal);
    if (policy.timeoutMs > 0)
      totalTimer = setTimeout(
        () =>
          stop(
            new RetryableDownloadError("模型下载超过请求总时限", { timeoutMs: policy.timeoutMs })
          ),
        policy.timeoutMs
      );
    renewIdle();
    report(0);
    response = await network<Response>(() =>
      Promise.resolve(
        fetcher(asset.source.downloadUrl, {
          signal: controller.signal,
          ...(attempt > 1 ? { cache: "reload" as const } : {})
        })
      ).then((value) => {
        // 已结束请求的迟到响应只做清理，不能再进入读取与进度链。
        response = value;
        if (!active || stopError) cancelBody(stopError);
        return value;
      })
    );
    if (!response.ok) {
      const details = {
        sourceKind: asset.source.kind,
        status: response.status,
        statusText: response.statusText
      };
      if (RETRYABLE_STATUSES.has(response.status))
        throw new RetryableDownloadError("模型下载返回可重试状态", details);
      throw new PPDetectionError("MODEL_DOWNLOAD_FAILED", "模型下载返回非成功状态", details);
    }
    validatePartialResponse(response, asset.source.bytes);
    contentLength(response, asset.source.bytes);
    if (!response.body) {
      const bytes = await network(() => response!.arrayBuffer());
      report(bytes.byteLength);
      return bytes;
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loadedBytes = 0;
    while (true) {
      const chunk = await network(() => reader!.read());
      if (chunk.done) break;
      if (chunk.value.byteLength === 0) continue;
      loadedBytes += chunk.value.byteLength;
      if (loadedBytes > asset.source.bytes)
        throw new PPDetectionError("MODEL_INTEGRITY_FAILED", "模型响应超过清单声明大小", {
          expectedBytes: asset.source.bytes,
          loadedBytes
        });
      chunks.push(chunk.value);
      renewIdle();
      report(loadedBytes);
    }
    const bytes = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    report(loadedBytes);
    return bytes.buffer;
  } catch (error) {
    controller.abort();
    cancelBody(error);
    throw error;
  } finally {
    active = false;
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    options.signal?.removeEventListener("abort", abort);
    try {
      reader?.releaseLock();
    } catch {
      // 非标准 reader 可能拒绝释放仍挂起的读取；取消已尽力发出。
    }
  }
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new PPDetectionError("ABORTED", "模型下载已取消"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function loadModelAsset(
  asset: ResolvedModelAsset,
  options: LoadModelAssetOptions = {}
): Promise<ModelBytes> {
  throwIfAborted(options.signal);
  const policy = resolveDownloadOptions(options.download);
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher)
    throw new PPDetectionError("MODEL_DOWNLOAD_FAILED", "当前环境没有 fetch API", {
      sourceKind: asset.source.kind
    });
  const downloadStarted = now();
  let bytes: ArrayBuffer;
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(options.signal);
    try {
      bytes = await downloadAttempt(asset, fetcher, options, policy, attempt);
      break;
    } catch (error) {
      throwIfAborted(options.signal);
      if (!(error instanceof RetryableDownloadError) || attempt > policy.maxRetries) throw error;
      await waitForRetry(Math.min(500 * 2 ** (attempt - 1), 4000), options.signal);
    }
  }
  const modelDownloadMs = now() - downloadStarted;
  const integrityStarted = now();
  await verifyModelIntegrity(bytes, asset.source, options.signal);
  return { bytes, timings: { modelDownloadMs, integrityMs: now() - integrityStarted } };
}
