import { PPDetectionError } from "../errors";

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PPDetectionError("ABORTED", "模型完整性校验已取消");
}

export async function calculateSha256(bytes: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  abortIfNeeded(signal);
  if (!globalThis.crypto?.subtle) {
    throw new PPDetectionError("MODEL_INTEGRITY_FAILED", "当前环境不支持 SHA-256 完整性校验", {
      algorithm: "SHA-256"
    });
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  abortIfNeeded(signal);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    ""
  );
}

export async function verifyModelIntegrity(
  bytes: ArrayBuffer,
  expected: { readonly bytes: number; readonly sha256: string },
  signal?: AbortSignal
): Promise<void> {
  abortIfNeeded(signal);
  if (bytes.byteLength !== expected.bytes) {
    throw new PPDetectionError("MODEL_INTEGRITY_FAILED", "模型文件大小与清单不一致", {
      expectedBytes: expected.bytes,
      actualBytes: bytes.byteLength
    });
  }
  const actualSha256 = await calculateSha256(bytes, signal);
  if (actualSha256 !== expected.sha256.toLowerCase()) {
    throw new PPDetectionError("MODEL_INTEGRITY_FAILED", "模型 SHA-256 与清单不一致", {
      expectedSha256: expected.sha256.toLowerCase(),
      actualSha256
    });
  }
}
