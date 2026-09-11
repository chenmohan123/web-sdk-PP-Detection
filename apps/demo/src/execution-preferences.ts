import type { ModelBackend, ModelManifest, RuntimeDetectionManifest } from "web-sdk-pp-detection";

export type BackendPreference = "auto" | ModelBackend;
export type PrecisionPreference = "auto" | "fp16" | "fp32";

const DEFAULT_SUPPORT = {
  webgpu: ["fp16", "fp32"],
  wasm: ["fp16", "fp32"]
} as const;

type SelectionManifest = ModelManifest | RuntimeDetectionManifest;

function supportsManifestCombination(
  manifest: SelectionManifest,
  backend: BackendPreference,
  precision: Exclude<PrecisionPreference, "auto">
): boolean {
  return manifest.variants.some((variant) => {
    const backends =
      "backendCompatibility" in variant ? variant.backendCompatibility : variant.backends;
    const usable =
      "validation" in variant
        ? variant.validation.included && variant.validation.pass
        : variant.status !== "blocked";
    return (
      variant.precision === precision &&
      usable &&
      (backend === "auto" || backends.includes(backend))
    );
  });
}

export function allowFallbackForSelection(
  backend: BackendPreference,
  precision: PrecisionPreference
): boolean {
  // 自动后端始终先尝试 WebGPU；精度选择只约束变体，不应关闭 CPU 回退。
  void precision;
  return backend === "auto";
}

export function supportsCombination(
  backend: ModelBackend,
  precision: Exclude<PrecisionPreference, "auto">,
  manifest?: SelectionManifest
): boolean {
  if (manifest === undefined) {
    return (DEFAULT_SUPPORT[backend] as readonly string[]).includes(precision);
  }
  return supportsManifestCombination(manifest, backend, precision);
}

export function precisionForBackend(
  backend: BackendPreference,
  precision: PrecisionPreference,
  manifest?: SelectionManifest
): PrecisionPreference {
  if (
    precision === "auto" ||
    (manifest === undefined
      ? backend === "auto" || supportsCombination(backend, precision)
      : supportsManifestCombination(manifest, backend, precision))
  ) {
    return precision;
  }
  return (
    (["fp16", "fp32"] as const).find((candidate) =>
      manifest === undefined
        ? backend === "auto" || supportsCombination(backend, candidate)
        : supportsManifestCombination(manifest, backend, candidate)
    ) ?? "auto"
  );
}
