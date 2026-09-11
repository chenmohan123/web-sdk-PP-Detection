import {
  parseDetectionManifest,
  type ModelSourceKind,
  type RuntimeDetectionManifest
} from "web-sdk-pp-detection";
import picoDetManifestJson from "../../../models/pp-detection/manifest.json";
import ppyoloeManifestJson from "../../../models/ppyoloe-plus-s-640/manifest.json";

export type DemoModelKey = "picodet-l-320" | "ppyoloe-plus-s-640";
export type ModelSourceKey = Extract<ModelSourceKind, "modelscope" | "huggingface">;

export interface DemoModelOption {
  readonly experimental: boolean;
  readonly key: DemoModelKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifest: RuntimeDetectionManifest;
  readonly manifestPath: string;
}

export interface ModelSourceOption {
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
}

export const DEFAULT_MODEL: DemoModelKey = "picodet-l-320";

export const MODEL_SOURCE_LABELS: Readonly<Record<ModelSourceKey, ModelSourceOption["label"]>> = {
  modelscope: { en: "ModelScope", zh: "ModelScope" },
  huggingface: { en: "Hugging Face", zh: "Hugging Face" }
};

const MODEL_SOURCE_ORDER: readonly ModelSourceKey[] = ["modelscope", "huggingface"];

export const MODEL_OPTIONS: readonly DemoModelOption[] = [
  {
    experimental: false,
    key: "picodet-l-320",
    label: { en: "PicoDet-L 320", zh: "PicoDet-L 320" },
    manifest: parseDetectionManifest(picoDetManifestJson),
    manifestPath: "models/pp-detection/manifest.json"
  },
  {
    experimental: false,
    key: "ppyoloe-plus-s-640",
    label: { en: "PP-YOLOE+ S 640", zh: "PP-YOLOE+ S 640" },
    manifest: parseDetectionManifest(ppyoloeManifestJson),
    manifestPath: "models/ppyoloe-plus-s-640/manifest.json"
  }
] as const;

export function modelOption(key: DemoModelKey): DemoModelOption {
  const option = MODEL_OPTIONS.find((candidate) => candidate.key === key);
  if (option === undefined) throw new Error(`未知 Demo 模型：${key}`);
  return option;
}

export function sourceOptions(option: DemoModelOption): readonly ModelSourceOption[] {
  const kinds = new Set<ModelSourceKind>();
  for (const variant of option.manifest.variants) {
    for (const source of variant.sources) kinds.add(source.kind);
  }
  return MODEL_SOURCE_ORDER.filter((key) => kinds.has(key)).map((key) => ({
    key,
    label: MODEL_SOURCE_LABELS[key]
  }));
}

export function defaultSource(option: DemoModelOption): ModelSourceKey {
  const options = sourceOptions(option);
  return options[0].key;
}
