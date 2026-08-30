import { PPDetectionError } from "../errors";
import type {
  Backend,
  DetectionModelVariant,
  ModelIdentity,
  ModelSource,
  ModelSourceKind,
  Precision,
  RuntimeDetectionManifest,
  TensorContract
} from "../types";

const SOURCE_KINDS = new Set<ModelSourceKind>(["git-lfs", "huggingface", "modelscope", "custom"]);
const BACKENDS = new Set<Backend>(["wasm", "webgpu"]);
const PRECISIONS = new Set<Precision>(["fp32", "fp16", "int8", "int4", "fp8"]);
const REVISION_PATTERN = /^[a-fA-F0-9]{40,64}$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, message: string): never {
  throw new PPDetectionError("INVALID_MANIFEST", `模型清单 ${path} ${message}`, { path });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(path, "必须是对象");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(path, "必须是非空字符串");
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) invalid(path, "必须是正整数");
  return value as number;
}

function nonNegativeIntegerOrNull(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) invalid(path, "必须是非负整数或 null");
  return value as number;
}

function threshold(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    invalid(path, "必须是 0 到 1 的有限数值");
  return value;
}

function optionalCoordinate(value: unknown, path: string): "pixels" | "normalized" | undefined {
  if (value === undefined) return undefined;
  if (value === "pixels") return "pixels";
  if (value === "normalized") return "normalized";
  invalid(path, "必须是 pixels 或 normalized");
}

function optionalBoxFormat(value: unknown, path: string): "cxcywh" | "xyxy" | undefined {
  if (value === undefined) return undefined;
  if (value === "cxcywh") return "cxcywh";
  if (value === "xyxy") return "xyxy";
  invalid(path, "必须是 cxcywh 或 xyxy");
}

function optionalResizeMode(value: unknown, path: string): "letterbox" | "stretch" | undefined {
  if (value === undefined) return undefined;
  if (value === "letterbox" || value === "stretch") return value;
  invalid(path, "必须是 letterbox 或 stretch");
}

function optionalInterpolation(value: unknown, path: string): "bilinear" | "bicubic" | undefined {
  if (value === undefined) return undefined;
  if (value === "bilinear" || value === "bicubic") return value;
  invalid(path, "必须是 bilinear 或 bicubic");
}

function optionalFiniteNumbers(value: unknown, path: string): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    invalid(path, "必须是非空的有限数值数组");
  }
  return value.map((item) => item as number);
}

function tensor(value: unknown, path: string, allowDynamic = false): TensorContract {
  const candidate = record(value, path);
  const shape = candidate.shape;
  if (
    !Array.isArray(shape) ||
    shape.length === 0 ||
    !shape.every(
      (dimension) =>
        Number.isInteger(dimension) && (dimension > 0 || (allowDynamic && dimension === -1))
    )
  ) {
    invalid(`${path}.shape`, "必须是非空的正整数数组");
  }
  return {
    name: text(candidate.name, `${path}.name`),
    shape: shape.map((dimension) => dimension as number),
    dtype: text(candidate.dtype, `${path}.dtype`)
  };
}

function source(value: unknown, path: string, variantBytes: number): ModelSource {
  const candidate = record(value, path);
  if (typeof candidate.kind !== "string" || !SOURCE_KINDS.has(candidate.kind as ModelSourceKind))
    invalid(`${path}.kind`, "不受支持");
  const revision = text(candidate.revision, `${path}.revision`);
  if (!REVISION_PATTERN.test(revision))
    invalid(`${path}.revision`, "必须是 40 至 64 位十六进制不可变 revision");
  const downloadUrl = text(candidate.downloadUrl, `${path}.downloadUrl`);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    invalid(`${path}.downloadUrl`, "必须是有效 URL");
  }
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.hostname === ""
  ) {
    invalid(`${path}.downloadUrl`, "必须是含主机的 HTTP(S) URL");
  }
  const bytes = positiveInteger(candidate.bytes, `${path}.bytes`);
  if (bytes !== variantBytes) invalid(`${path}.bytes`, "必须与变体大小一致");
  const sha256 = text(candidate.sha256, `${path}.sha256`).toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) invalid(`${path}.sha256`, "必须是 64 位十六进制摘要");
  return {
    kind: candidate.kind as ModelSourceKind,
    repository: text(candidate.repository, `${path}.repository`),
    revision,
    path: text(candidate.path, `${path}.path`),
    downloadUrl,
    bytes,
    sha256
  };
}

function variant(value: unknown, path: string): DetectionModelVariant {
  const candidate = record(value, path);
  if (typeof candidate.precision !== "string" || !PRECISIONS.has(candidate.precision as Precision))
    invalid(`${path}.precision`, "不受支持");
  if (
    candidate.quantization !== null &&
    (typeof candidate.quantization !== "string" || candidate.quantization.trim() === "")
  ) {
    invalid(`${path}.quantization`, "必须是非空字符串或 null");
  }
  if (
    !Array.isArray(candidate.backends) ||
    candidate.backends.length === 0 ||
    !candidate.backends.every(
      (backend) => typeof backend === "string" && BACKENDS.has(backend as Backend)
    )
  ) {
    invalid(`${path}.backends`, "必须是非空的 wasm/webgpu 数组");
  }
  const bytes = positiveInteger(candidate.bytes, `${path}.bytes`);
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0)
    invalid(`${path}.sources`, "必须是非空数组");
  const sources = candidate.sources.map((item, index) =>
    source(item, `${path}.sources[${index}]`, bytes)
  );
  if (new Set(sources.map((item) => item.kind)).size !== sources.length)
    invalid(`${path}.sources`, "同一变体中的来源 kind 不得重复");
  const backends = candidate.backends.map((backend) => backend as Backend);
  const status = candidate.status;
  if (status !== undefined && status !== "stable" && status !== "labs" && status !== "blocked")
    invalid(`${path}.status`, "不受支持");
  return {
    id: text(candidate.id, `${path}.id`),
    precision: candidate.precision as Precision,
    quantization: candidate.quantization === null ? null : candidate.quantization,
    opset: positiveInteger(candidate.opset, `${path}.opset`),
    bytes,
    parameterCount: nonNegativeIntegerOrNull(candidate.parameterCount, `${path}.parameterCount`),
    backends,
    sources,
    ...(status === undefined ? {} : { status })
  };
}

export function parseDetectionManifest(value: unknown): RuntimeDetectionManifest {
  const candidate = record(value, "根节点");
  if (candidate.schemaVersion !== 1) invalid("schemaVersion", "必须是 1");
  const modelValue = record(candidate.model, "model");
  const model: ModelIdentity = {
    id: text(modelValue.id, "model.id"),
    version: text(modelValue.version, "model.version")
  };
  if (!Array.isArray(candidate.outputs) || candidate.outputs.length === 0)
    invalid("outputs", "必须是非空数组");
  const preprocessing = record(candidate.preprocessing, "preprocessing");
  const size = record(preprocessing.size, "preprocessing.size");
  if (
    typeof preprocessing.rescaleFactor !== "number" ||
    !Number.isFinite(preprocessing.rescaleFactor) ||
    preprocessing.rescaleFactor <= 0
  ) {
    invalid("preprocessing.rescaleFactor", "必须是正有限数值");
  }
  for (const field of ["doResize", "doRescale", "doNormalize"] as const) {
    if (preprocessing[field] !== undefined && typeof preprocessing[field] !== "boolean")
      invalid(`preprocessing.${field}`, "必须是布尔值");
  }
  const postprocessing = record(candidate.postprocessing, "postprocessing");
  if (postprocessing.type !== "nms") invalid("postprocessing.type", "目前只支持 nms");
  const matrixCoordinates = optionalCoordinate(
    postprocessing.matrixCoordinates,
    "postprocessing.matrixCoordinates"
  );
  const queryCoordinates = optionalCoordinate(
    postprocessing.queryCoordinates,
    "postprocessing.queryCoordinates"
  );
  const queryBoxFormat = optionalBoxFormat(
    postprocessing.queryBoxFormat,
    "postprocessing.queryBoxFormat"
  );
  const resizeMode = optionalResizeMode(preprocessing.resizeMode, "preprocessing.resizeMode");
  const interpolation = optionalInterpolation(
    preprocessing.interpolation,
    "preprocessing.interpolation"
  );
  if (
    !Array.isArray(candidate.labels) ||
    candidate.labels.length === 0 ||
    !candidate.labels.every((label) => typeof label === "string" && label.trim() !== "")
  ) {
    invalid("labels", "必须是非空字符串数组");
  }
  if (!Array.isArray(candidate.variants) || candidate.variants.length === 0)
    invalid("variants", "必须是非空数组");
  const variants = candidate.variants.map((item, index) => variant(item, `variants[${index}]`));
  if (new Set(variants.map((item) => item.id)).size !== variants.length)
    invalid("variants", "变体 id 不得重复");
  const input = tensor(candidate.input, "input");
  const mean = optionalFiniteNumbers(preprocessing.mean, "preprocessing.mean");
  const std = optionalFiniteNumbers(preprocessing.std, "preprocessing.std");
  const channels = input.shape[1];
  if (mean !== undefined && mean.length !== channels)
    invalid("preprocessing.mean", "长度必须与输入通道数一致");
  if (std !== undefined && std.length !== channels)
    invalid("preprocessing.std", "长度必须与输入通道数一致");
  if (std?.some((value) => value <= 0)) invalid("preprocessing.std", "必须全部大于零");
  return {
    schemaVersion: 1,
    model,
    input,
    outputs: candidate.outputs.map((item, index) => tensor(item, `outputs[${index}]`, true)),
    preprocessing: {
      size: {
        width: positiveInteger(size.width, "preprocessing.size.width"),
        height: positiveInteger(size.height, "preprocessing.size.height")
      },
      rescaleFactor: preprocessing.rescaleFactor,
      ...(resizeMode === undefined ? {} : { resizeMode }),
      ...(interpolation === undefined ? {} : { interpolation }),
      ...(typeof preprocessing.doResize === "boolean" ? { doResize: preprocessing.doResize } : {}),
      ...(typeof preprocessing.doRescale === "boolean"
        ? { doRescale: preprocessing.doRescale }
        : {}),
      ...(typeof preprocessing.doNormalize === "boolean"
        ? { doNormalize: preprocessing.doNormalize }
        : {}),
      ...(mean === undefined ? {} : { mean }),
      ...(std === undefined ? {} : { std })
    },
    postprocessing: {
      type: "nms",
      scoreThreshold: threshold(postprocessing.scoreThreshold, "postprocessing.scoreThreshold"),
      iouThreshold: threshold(postprocessing.iouThreshold, "postprocessing.iouThreshold"),
      ...(matrixCoordinates === undefined ? {} : { matrixCoordinates }),
      ...(queryCoordinates === undefined ? {} : { queryCoordinates }),
      ...(queryBoxFormat === undefined ? {} : { queryBoxFormat })
    },
    labels: candidate.labels.map((label) => label as string),
    variants
  };
}
