export type ModelSourceKey = "huggingface" | "modelscope" | "git-lfs" | "default";

export interface ModelSourceOption {
  readonly available: boolean;
  readonly disabledReason?: Readonly<{ en: string; zh: string }>;
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifestUrl?: string;
}

export const DEFAULT_MODEL_SOURCE: ModelSourceKey = "huggingface";

const MANIFEST_URLS = {
  huggingface:
    "https://huggingface.co/chenmohan/web-sdk-pp-detection/resolve/main/manifest.json?v=1.0.1",
  modelscope:
    "https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/master/manifest.json?v=1.0.1",
  "git-lfs":
    "https://raw.githubusercontent.com/chenmohan123/web-sdk-PP-Detection/main/models/pp-detection/manifest.json?v=1.0.1"
} as const;

export const MODEL_SOURCE_OPTIONS: readonly ModelSourceOption[] = [
  {
    available: true,
    key: "huggingface",
    label: { en: "Hugging Face", zh: "Hugging Face" },
    manifestUrl: MANIFEST_URLS.huggingface
  },
  {
    available: true,
    key: "modelscope",
    label: { en: "ModelScope", zh: "ModelScope" },
    manifestUrl: MANIFEST_URLS.modelscope
  },
  {
    available: true,
    key: "git-lfs",
    label: { en: "Git LFS", zh: "Git LFS" },
    manifestUrl: MANIFEST_URLS["git-lfs"]
  },
  {
    available: true,
    key: "default",
    label: { en: "SDK default", zh: "SDK 默认" },
    manifestUrl: MANIFEST_URLS.huggingface
  }
] as const;

export function selectionToModel(source: ModelSourceKey): string | undefined {
  return MODEL_SOURCE_OPTIONS.find((option) => option.key === source)?.manifestUrl;
}
