import { PPDetectionError } from "../errors";
import type {
  Backend,
  BackendPreference,
  DetectionCapabilities,
  DetectionManifest,
  ExecutionMode,
  Precision,
  RuntimeInfo
} from "../types";

export interface SelectExecutionOptions {
  readonly backend?: BackendPreference;
  readonly precision?: Precision;
  readonly executionMode?: ExecutionMode;
  readonly allowFallback?: boolean;
}

export interface ExecutionCandidate {
  readonly variantId: string;
  readonly backend: Backend;
  readonly precision: Precision;
  readonly executionMode: ExecutionMode;
}

export type ExecutionPlan = RuntimeInfo & {
  readonly variantId: string;
  readonly candidates: readonly ExecutionCandidate[];
};

function fail(
  code: "CAPABILITY_UNSUPPORTED" | "MODEL_INCOMPATIBLE",
  message: string,
  details: Record<string, unknown>
): never {
  throw new PPDetectionError(code, message, details);
}

function candidatesForBackend(
  requested: BackendPreference,
  capabilities: DetectionCapabilities
): Backend[] {
  if (requested === "wasm") return ["wasm"];
  if (requested === "webgpu")
    return capabilities.webgpu
      ? ["webgpu"]
      : fail("CAPABILITY_UNSUPPORTED", "请求的 webgpu 不可用", { requestedBackend: requested });
  const available: Backend[] = [];
  if (capabilities.webgpu) available.push("webgpu");
  available.push("wasm");
  return available;
}

export function selectExecutionPlan(
  options: SelectExecutionOptions,
  capabilities: DetectionCapabilities,
  manifest: DetectionManifest
): ExecutionPlan {
  const requestedBackend = options.backend ?? "auto";
  const requestedPrecision = options.precision ?? "fp32";
  const executionMode = options.executionMode ?? "main";
  if (executionMode === "worker" && !capabilities.worker) {
    fail("CAPABILITY_UNSUPPORTED", "请求的 worker 不可用", { executionMode });
  }
  const variant = manifest.variants?.find(
    (candidate) =>
      candidate.precision === requestedPrecision &&
      candidate.status !== "labs" &&
      candidate.status !== "blocked"
  );
  if (!variant) {
    fail("MODEL_INCOMPATIBLE", `manifest 没有可用的 ${requestedPrecision} 稳定变体`, {
      requestedPrecision
    });
  }
  const candidates = candidatesForBackend(requestedBackend, capabilities).filter((backend) =>
    variant.backends.includes(backend)
  );
  const selectedCandidates = options.allowFallback === true ? candidates : candidates.slice(0, 1);
  if (selectedCandidates.length === 0) {
    fail("CAPABILITY_UNSUPPORTED", "没有与模型变体匹配的可用后端", {
      requestedBackend,
      requestedPrecision,
      availableBackends: variant.backends
    });
  }
  const actualBackend = selectedCandidates[0];
  return {
    variantId: variant.id,
    requestedBackend,
    actualBackend,
    requestedPrecision,
    actualPrecision: variant.precision,
    executionMode,
    candidates: selectedCandidates.map((backend) => ({
      variantId: variant.id,
      backend,
      precision: variant.precision,
      executionMode
    }))
  };
}
