export type ModelSourceKey = "huggingface" | "modelscope" | "git-lfs" | "default";

export interface ModelSourceOption {
  readonly available: boolean;
  readonly disabledReason?: Readonly<{ en: string; zh: string }>;
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifestUrl?: string;
}

export const DEFAULT_MODEL_SOURCE: ModelSourceKey = "huggingface";

const MODEL_REVISION = {
  // 清单与模型文件分别固定到各自的不可变提交。
  // b089 提交只包含候选根清单；12eb 提交更新为 1.0.1 完整清单。
  huggingface: "12ebc1cd90f163c73ff2ae98446925b713b1a719",
  modelscope: "5dc50e4488a81c62cada7879b685f0301449930d",
  "git-lfs": "3d194b9ebff50175ebb0c9d36702852d7b7e506e"
} as const;

const MANIFEST_URLS = {
  huggingface: `https://huggingface.co/chenmohan/web-sdk-pp-detection/resolve/${MODEL_REVISION.huggingface}/manifest.json`,
  modelscope: `https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/${MODEL_REVISION.modelscope}/manifest.json`,
  "git-lfs": `https://raw.githubusercontent.com/chenmohan123/web-sdk-PP-Detection/${MODEL_REVISION["git-lfs"]}/models/pp-detection/1.0.1/manifest.json`
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
