export type ModelSourceKey = "huggingface" | "modelscope" | "git-lfs" | "default";

export interface ModelSourceOption {
  readonly available: boolean;
  readonly disabledReason?: Readonly<{ en: string; zh: string }>;
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifestUrl?: string;
}

export const DEFAULT_MODEL_SOURCE: ModelSourceKey = "huggingface";

const BLOCKED_REASON = {
  en: "The PicoDet 1.0.1 asset is blocked until browser and license evidence is complete.",
  zh: "PicoDet 1.0.1 资产尚未完成浏览器与许可证据验证。"
} as const;

const MODEL_REVISION = {
  // 清单与模型文件分别固定到各自的不可变提交。
  huggingface: "314145f779a883449784fe8a8e98647f63f39415",
  modelscope: "86fff1bb7c01982c696e677116504dcb5a3fca2c",
  "git-lfs": "50ec35925ca89945dcfc4d13935e65bf054ac741"
} as const;

const MANIFEST_URLS = {
  huggingface: `https://huggingface.co/chenmohan/web-sdk-pp-detection/resolve/${MODEL_REVISION.huggingface}/manifest.json`,
  modelscope: `https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/${MODEL_REVISION.modelscope}/manifest.json`,
  "git-lfs": `https://raw.githubusercontent.com/chenmohan123/web-sdk-PP-Detection/${MODEL_REVISION["git-lfs"]}/models/pp-detection/1.0.0/manifest.json`
} as const;

export const MODEL_SOURCE_OPTIONS: readonly ModelSourceOption[] = [
  {
    available: false,
    disabledReason: BLOCKED_REASON,
    key: "huggingface",
    label: { en: "Hugging Face", zh: "Hugging Face" },
    manifestUrl: MANIFEST_URLS.huggingface
  },
  {
    available: false,
    disabledReason: BLOCKED_REASON,
    key: "modelscope",
    label: { en: "ModelScope", zh: "ModelScope" },
    manifestUrl: MANIFEST_URLS.modelscope
  },
  {
    available: false,
    disabledReason: BLOCKED_REASON,
    key: "git-lfs",
    label: { en: "Git LFS", zh: "Git LFS" },
    manifestUrl: MANIFEST_URLS["git-lfs"]
  },
  {
    available: false,
    disabledReason: BLOCKED_REASON,
    key: "default",
    label: { en: "SDK default", zh: "SDK 默认" },
    manifestUrl: MANIFEST_URLS.huggingface
  }
] as const;

export function selectionToModel(source: ModelSourceKey): string | undefined {
  return MODEL_SOURCE_OPTIONS.find((option) => option.key === source)?.manifestUrl;
}
