import { PPDetectionError } from "../errors";
import type { TimingBreakdown } from "../types";
import { verifyModelIntegrity } from "./integrity";
import type { ResolvedModelAsset } from "./source-resolver";

export type ModelFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ModelDownloadProgress {
  readonly loadedBytes: number;
  readonly totalBytes?: number;
}

export interface LoadModelAssetOptions {
  readonly fetcher?: ModelFetcher;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ModelDownloadProgress) => void;
}

export interface ModelBytes {
  readonly bytes: ArrayBuffer;
  readonly timings: Pick<TimingBreakdown, "modelDownloadMs" | "integrityMs">;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function aborted(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
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

async function readResponse(
  response: Response,
  expectedBytes: number,
  signal?: AbortSignal,
  onProgress?: (progress: ModelDownloadProgress) => void
): Promise<ArrayBuffer> {
  const totalBytes = contentLength(response, expectedBytes);
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    throwIfAborted(signal);
    onProgress?.({ loadedBytes: bytes.byteLength, totalBytes });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      loadedBytes += chunk.value.byteLength;
      if (loadedBytes > expectedBytes) {
        throw new PPDetectionError("MODEL_INTEGRITY_FAILED", "模型响应超过清单声明大小", {
          expectedBytes,
          loadedBytes
        });
      }
      chunks.push(chunk.value);
      onProgress?.({ loadedBytes, totalBytes });
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // 保留原始读取或完整性错误。
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.({ loadedBytes, totalBytes });
  return bytes.buffer;
}

export async function loadModelAsset(
  asset: ResolvedModelAsset,
  options: LoadModelAssetOptions = {}
): Promise<ModelBytes> {
  throwIfAborted(options.signal);
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher)
    throw new PPDetectionError("MODEL_DOWNLOAD_FAILED", "当前环境没有 fetch API", {
      sourceKind: asset.source.kind
    });
  const downloadStarted = now();
  let response: Response;
  try {
    response = await fetcher(asset.source.downloadUrl, { signal: options.signal });
  } catch (error) {
    if (aborted(error, options.signal))
      throw new PPDetectionError("ABORTED", "模型下载已取消", {}, { cause: error });
    throw new PPDetectionError(
      "MODEL_DOWNLOAD_FAILED",
      "模型下载请求失败",
      {
        sourceKind: asset.source.kind,
        downloadUrl: asset.source.downloadUrl
      },
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new PPDetectionError("MODEL_DOWNLOAD_FAILED", "模型下载返回非成功状态", {
      sourceKind: asset.source.kind,
      status: response.status,
      statusText: response.statusText
    });
  }
  validatePartialResponse(response, asset.source.bytes);
  let bytes: ArrayBuffer;
  try {
    bytes = await readResponse(response, asset.source.bytes, options.signal, options.onProgress);
  } catch (error) {
    if (error instanceof PPDetectionError) throw error;
    if (aborted(error, options.signal))
      throw new PPDetectionError("ABORTED", "模型下载已取消", {}, { cause: error });
    throw new PPDetectionError(
      "MODEL_DOWNLOAD_FAILED",
      "读取模型响应失败",
      { sourceKind: asset.source.kind },
      { cause: error }
    );
  }
  const modelDownloadMs = now() - downloadStarted;
  const integrityStarted = now();
  await verifyModelIntegrity(bytes, asset.source, options.signal);
  return {
    bytes,
    timings: {
      modelDownloadMs,
      integrityMs: now() - integrityStarted
    }
  };
}
