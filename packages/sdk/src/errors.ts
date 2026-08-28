export type PPDetectionErrorCode =
  | "CAPABILITY_UNSUPPORTED"
  | "INVALID_INPUT"
  | "INVALID_MANIFEST"
  | "MODEL_INCOMPATIBLE"
  | "MODEL_SOURCE_UNAVAILABLE"
  | "MODEL_DOWNLOAD_FAILED"
  | "MODEL_INTEGRITY_FAILED"
  | "SESSION_CREATE_FAILED"
  | "INFERENCE_FAILED"
  | "OUT_OF_MEMORY"
  | "ABORTED"
  | "DISPOSED";

export class PPDetectionError extends Error {
  constructor(
    public readonly code: PPDetectionErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PPDetectionError";
  }
}
