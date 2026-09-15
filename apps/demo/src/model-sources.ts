import {
  parseDetectionManifest,
  type ModelSourceKind,
  type RuntimeDetectionManifest
} from "web-sdk-pp-detection";
import picoDetManifestJson from "../../../models/pp-detection/1.0.2/manifest.json";
import picoDetXs320ManifestJson from "../../../models/pp-detection/picodet-xs-320/1.0.1/manifest.json";
import picoDetXs416ManifestJson from "../../../models/pp-detection/picodet-xs-416/1.0.1/manifest.json";
import picoDetS320ManifestJson from "../../../models/pp-detection/picodet-s-320/1.0.1/manifest.json";
import picoDetS416ManifestJson from "../../../models/pp-detection/picodet-s-416/1.0.1/manifest.json";
import picoDetM320ManifestJson from "../../../models/pp-detection/picodet-m-320/1.0.1/manifest.json";
import picoDetM416ManifestJson from "../../../models/pp-detection/picodet-m-416/1.0.1/manifest.json";
import picoDetL416ManifestJson from "../../../models/pp-detection/picodet-l-416/1.0.1/manifest.json";
import picoDetL640ManifestJson from "../../../models/pp-detection/picodet-l-640/1.0.1/manifest.json";
import ppyoloeManifestJson from "../../../models/ppyoloe-plus-s-640/0.1.1/manifest.json";
import ppyoloeMManifestJson from "../../../models/ppyoloe-plus-m-640/0.1.1/manifest.json";
import ppyoloeLManifestJson from "../../../models/ppyoloe-plus-l-640/0.1.1/manifest.json";
import ppyoloeXManifestJson from "../../../models/ppyoloe-plus-x-640/0.1.1/manifest.json";

import ppyoloTinyManifestJson from "../../../models/ppyolo-tiny-320/0.1.0/manifest.json";

export type DemoModelKey =
  | "picodet-xs-320"
  | "picodet-xs-416"
  | "picodet-s-320"
  | "picodet-s-416"
  | "picodet-m-320"
  | "picodet-m-416"
  | "picodet-l-320"
  | "picodet-l-416"
  | "picodet-l-640"
  | "ppyoloe-plus-s-640"
  | "ppyoloe-plus-m-640"
  | "ppyoloe-plus-l-640"
  | "ppyoloe-plus-x-640"
  | "ppyolo-tiny-320";
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
    key: "picodet-xs-320",
    label: { en: "PicoDet-XS 320", zh: "PicoDet-XS 320" },
    manifest: parseDetectionManifest(picoDetXs320ManifestJson),
    manifestPath: "models/pp-detection/picodet-xs-320/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-xs-416",
    label: { en: "PicoDet-XS 416", zh: "PicoDet-XS 416" },
    manifest: parseDetectionManifest(picoDetXs416ManifestJson),
    manifestPath: "models/pp-detection/picodet-xs-416/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-s-320",
    label: { en: "PicoDet-S 320", zh: "PicoDet-S 320" },
    manifest: parseDetectionManifest(picoDetS320ManifestJson),
    manifestPath: "models/pp-detection/picodet-s-320/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-s-416",
    label: { en: "PicoDet-S 416", zh: "PicoDet-S 416" },
    manifest: parseDetectionManifest(picoDetS416ManifestJson),
    manifestPath: "models/pp-detection/picodet-s-416/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-m-320",
    label: { en: "PicoDet-M 320", zh: "PicoDet-M 320" },
    manifest: parseDetectionManifest(picoDetM320ManifestJson),
    manifestPath: "models/pp-detection/picodet-m-320/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-m-416",
    label: { en: "PicoDet-M 416", zh: "PicoDet-M 416" },
    manifest: parseDetectionManifest(picoDetM416ManifestJson),
    manifestPath: "models/pp-detection/picodet-m-416/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-l-320",
    label: { en: "PicoDet-L 320", zh: "PicoDet-L 320" },
    manifest: parseDetectionManifest(picoDetManifestJson),
    manifestPath: "models/pp-detection/1.0.2/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-l-416",
    label: { en: "PicoDet-L 416", zh: "PicoDet-L 416" },
    manifest: parseDetectionManifest(picoDetL416ManifestJson),
    manifestPath: "models/pp-detection/picodet-l-416/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "picodet-l-640",
    label: { en: "PicoDet-L 640", zh: "PicoDet-L 640" },
    manifest: parseDetectionManifest(picoDetL640ManifestJson),
    manifestPath: "models/pp-detection/picodet-l-640/1.0.1/manifest.json"
  },
  {
    experimental: false,
    key: "ppyoloe-plus-s-640",
    label: { en: "PP-YOLOE+ S 640", zh: "PP-YOLOE+ S 640" },
    manifest: parseDetectionManifest(ppyoloeManifestJson),
    manifestPath: "models/ppyoloe-plus-s-640/0.1.1/manifest.json"
  },
  {
    experimental: false,
    key: "ppyoloe-plus-m-640",
    label: { en: "PP-YOLOE+ M 640", zh: "PP-YOLOE+ M 640" },
    manifest: parseDetectionManifest(ppyoloeMManifestJson),
    manifestPath: "models/ppyoloe-plus-m-640/0.1.1/manifest.json"
  },
  {
    experimental: false,
    key: "ppyoloe-plus-l-640",
    label: { en: "PP-YOLOE+ L 640", zh: "PP-YOLOE+ L 640" },
    manifest: parseDetectionManifest(ppyoloeLManifestJson),
    manifestPath: "models/ppyoloe-plus-l-640/0.1.1/manifest.json"
  },
  {
    experimental: false,
    key: "ppyoloe-plus-x-640",
    label: { en: "PP-YOLOE+ X 640", zh: "PP-YOLOE+ X 640" },
    manifest: parseDetectionManifest(ppyoloeXManifestJson),
    manifestPath: "models/ppyoloe-plus-x-640/0.1.1/manifest.json"
  },
  {
    experimental: false,
    key: "ppyolo-tiny-320",
    label: { en: "PP-YOLO Tiny 320", zh: "PP-YOLO Tiny 320" },
    manifest: parseDetectionManifest(ppyoloTinyManifestJson),
    manifestPath: "models/ppyolo-tiny-320/0.1.0/manifest.json"
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
