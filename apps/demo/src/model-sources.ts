export type ModelSourceKey = "default" | "huggingface" | "modelscope";

export interface ModelSourceOption {
  readonly available: boolean;
  readonly disabledReason?: Readonly<{ en: string; zh: string }>;
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifestUrl?: string;
}

export const DEFAULT_MODEL_SOURCE: ModelSourceKey = "default";

export const MODEL_SOURCE_OPTIONS: readonly ModelSourceOption[] = [
  {
    available: true,
    key: "default",
    label: { en: "SDK default", zh: "SDK 默认" }
  },
  {
    available: false,
    disabledReason: {
      en: "The PicoDet ONNX asset is blocked until an immutable release is verified.",
      zh: "PicoDet ONNX 资产尚未完成不可变发布验证。"
    },
    key: "huggingface",
    label: { en: "Hugging Face", zh: "Hugging Face" }
  },
  {
    available: false,
    disabledReason: {
      en: "The PicoDet ONNX asset is blocked until an immutable release is verified.",
      zh: "PicoDet ONNX 资产尚未完成不可变发布验证。"
    },
    key: "modelscope",
    label: { en: "ModelScope", zh: "ModelScope" }
  }
] as const;

export function selectionToModel(source: ModelSourceKey): string | undefined {
  return MODEL_SOURCE_OPTIONS.find((option) => option.key === source)?.manifestUrl;
}
