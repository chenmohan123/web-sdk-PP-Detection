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
  // cd53 提交包含稳定的 1.0.1 根清单；ModelScope 尚未提供稳定清单。
  huggingface: "cd53bb62104f3f32123b56e981293d64ca321a0e",
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
    available: false,
    disabledReason: {
      en: "The ModelScope manifest is still a candidate release and is temporarily blocked.",
      zh: "ModelScope 清单仍是候选版本，暂时阻塞。"
    },
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
