import { PPDetectionError } from "../errors";
import type {
  DetectionModelVariant,
  ModelIdentity,
  ModelSource,
  ModelSourceKind,
  RuntimeDetectionManifest
} from "../types";

export type ModelSourceSelection = ModelSourceKind | "auto";

export interface ResolveModelAssetSelection {
  readonly variantId?: string;
  readonly sourceKind?: ModelSourceSelection;
}

export interface ResolvedModelAsset {
  readonly model: ModelIdentity;
  readonly variant: DetectionModelVariant;
  readonly source: ModelSource;
}

export function resolveModelVariant(
  manifest: RuntimeDetectionManifest,
  variantId?: string
): DetectionModelVariant {
  const variant =
    variantId === undefined
      ? manifest.variants[0]
      : manifest.variants.find((candidate) => candidate.id === variantId);
  if (!variant) {
    throw new PPDetectionError("MODEL_INCOMPATIBLE", "请求的模型变体不存在", {
      variantId,
      availableVariants: manifest.variants.map((candidate) => candidate.id)
    });
  }
  return variant;
}

export function resolveModelSources(
  variant: DetectionModelVariant,
  sourceKind: ModelSourceSelection = "auto"
): readonly ModelSource[] {
  if (sourceKind === "auto") return variant.sources;
  const source = variant.sources.find((candidate) => candidate.kind === sourceKind);
  if (!source) {
    throw new PPDetectionError("MODEL_SOURCE_UNAVAILABLE", "请求的模型来源不存在", {
      sourceKind,
      availableSources: variant.sources.map((candidate) => candidate.kind)
    });
  }
  return [source];
}

export function resolveModelAsset(
  selection: ResolveModelAssetSelection,
  manifest: RuntimeDetectionManifest
): ResolvedModelAsset {
  const variant = resolveModelVariant(manifest, selection.variantId);
  const [source] = resolveModelSources(variant, selection.sourceKind);
  if (!source)
    throw new PPDetectionError("MODEL_SOURCE_UNAVAILABLE", "模型变体没有可用来源", {
      variantId: variant.id
    });
  return { model: manifest.model, variant, source };
}
