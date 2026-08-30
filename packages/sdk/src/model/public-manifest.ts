import { PPDetectionError } from "../errors";
import type {
  Backend,
  ModelManifest,
  ModelManifestVariant,
  ModelSourceKind,
  Precision,
  RuntimeDetectionManifest,
  TensorContract
} from "../types";
import { parseDetectionManifest } from "./manifest";

const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const BACKENDS = new Set<Backend>(["wasm", "webgpu"]);
const PRECISIONS = new Set<Precision>(["fp32", "fp16", "int8", "int4", "fp8"]);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PPDetectionError("INVALID_MANIFEST", `模型清单 ${path} 必须是对象`, { path });
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, message: string): never {
  throw new PPDetectionError("INVALID_MANIFEST", `模型清单 ${path} ${message}`, { path });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(path, "必须是非空字符串");
  return value;
}

function integer(value: unknown, path: string, allowZero = false): number {
  if (!Number.isInteger(value) || (allowZero ? (value as number) < 0 : (value as number) <= 0)) {
    invalid(path, allowZero ? "必须是非负整数" : "必须是正整数");
  }
  return value as number;
}

function nonNegativeIntegerOrNull(value: unknown, path: string): number | null {
  if (value === null) return null;
  return integer(value, path, true);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "必须是有限数值");
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "必须是布尔值");
  return value;
}

function resizeMode(value: unknown, path: string): "letterbox" | "stretch" | undefined {
  if (value === undefined) return undefined;
  if (value === "letterbox" || value === "stretch") return value;
  invalid(path, "必须是 letterbox 或 stretch");
}

function interpolation(value: unknown, path: string): "bilinear" | "bicubic" | undefined {
  if (value === undefined) return undefined;
  if (value === "bilinear" || value === "bicubic") return value;
  invalid(path, "必须是 bilinear 或 bicubic");
}

function resample(value: unknown, path: string): 2 | 3 {
  const result = integer(value, path, true);
  if (result === 2 || result === 3) return result;
  invalid(path, "目前只支持 2 (bilinear) 或 3 (bicubic)");
}

function url(value: unknown, path: string): string {
  const result = text(value, path);
  try {
    const parsed = new URL(result);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error();
  } catch {
    invalid(path, "必须是含主机的 HTTP(S) URL");
  }
  return result;
}

function tensor(value: unknown, path: string, allowDynamic = false): TensorContract {
  const candidate = record(value, path);
  if (
    !Array.isArray(candidate.shape) ||
    candidate.shape.length === 0 ||
    !candidate.shape.every(
      (dimension) =>
        Number.isInteger(dimension) && (dimension > 0 || (allowDynamic && dimension === -1))
    )
  ) {
    invalid(`${path}.shape`, "必须是正整数数组");
  }
  return {
    name: text(candidate.name, `${path}.name`),
    dtype: text(candidate.dtype, `${path}.dtype`),
    shape: candidate.shape.map(Number)
  };
}

function triple(value: unknown, path: string, positive = false): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) invalid(path, "必须包含 3 个数值");
  const result = value.map((item, index) => finite(item, `${path}[${index}]`));
  if (positive && result.some((item) => item <= 0)) invalid(path, "必须全部大于零");
  return result as [number, number, number];
}

function variant(value: unknown, path: string): ModelManifestVariant {
  const candidate = record(value, path);
  if (
    !Array.isArray(candidate.backendCompatibility) ||
    candidate.backendCompatibility.length === 0 ||
    !candidate.backendCompatibility.every(
      (backend) => typeof backend === "string" && BACKENDS.has(backend as Backend)
    )
  ) {
    invalid(`${path}.backendCompatibility`, "必须是非空的 wasm/webgpu 数组");
  }
  if (
    typeof candidate.precision !== "string" ||
    !PRECISIONS.has(candidate.precision as Precision)
  ) {
    invalid(`${path}.precision`, "不受支持");
  }
  if (
    candidate.quantization !== undefined &&
    candidate.quantization !== null &&
    (typeof candidate.quantization !== "string" || candidate.quantization.trim() === "")
  ) {
    invalid(`${path}.quantization`, "必须是非空字符串或 null");
  }
  const sha256 = text(candidate.sha256, `${path}.sha256`).toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) invalid(`${path}.sha256`, "必须是 64 位十六进制摘要");
  const validation = record(candidate.validation, `${path}.validation`);
  return {
    backendCompatibility: candidate.backendCompatibility.map((backend) => backend as Backend),
    bytes: integer(candidate.bytes, `${path}.bytes`),
    filename: text(candidate.filename, `${path}.filename`),
    id: text(candidate.id, `${path}.id`),
    opset: integer(candidate.opset, `${path}.opset`),
    precision: candidate.precision as Precision,
    quantization: candidate.quantization === undefined ? null : candidate.quantization,
    sha256,
    url: url(candidate.url, `${path}.url`),
    validation: {
      included: boolean(validation.included, `${path}.validation.included`),
      pass: boolean(validation.pass, `${path}.validation.pass`),
      report: text(validation.report, `${path}.validation.report`)
    }
  };
}

export function parseModelManifest(value: unknown): ModelManifest {
  const candidate = record(value, "根节点");
  if (candidate.schemaVersion !== 1) invalid("schemaVersion", "必须是 1");
  const model = record(candidate.model, "model");
  const preprocessing = record(candidate.preprocessing, "preprocessing");
  const size = record(preprocessing.size, "preprocessing.size");
  const source = record(candidate.source, "source");
  const files = record(source.files, "source.files");
  const preprocessingInterpolation = interpolation(
    preprocessing.interpolation,
    "preprocessing.interpolation"
  );
  const preprocessingResample = resample(preprocessing.resample, "preprocessing.resample");
  const input = tensor(candidate.input, "input");
  if (input.shape.length !== 4 || input.shape[0] !== 1 || input.shape[1] !== 3) {
    invalid("input.shape", "目前只支持 [1,3,H,W]");
  }
  if (!Array.isArray(candidate.outputs) || candidate.outputs.length === 0) {
    invalid("outputs", "必须是非空数组");
  }
  if (!Array.isArray(candidate.labels) || !candidate.labels.length)
    invalid("labels", "必须是非空数组");
  const labels = candidate.labels.map((label, index) => text(label, `labels[${index}]`));
  if (!Array.isArray(candidate.variants) || !candidate.variants.length) {
    invalid("variants", "必须是非空数组");
  }
  const variants = candidate.variants.map((item, index) => variant(item, `variants[${index}]`));
  if (new Set(variants.map((item) => item.id)).size !== variants.length)
    invalid("variants", "id 不得重复");
  if (!Array.isArray(candidate.variantPriority) || !candidate.variantPriority.length) {
    invalid("variantPriority", "必须是非空数组");
  }
  const variantPriority = candidate.variantPriority.map((item, index) =>
    text(item, `variantPriority[${index}]`)
  );
  if (variantPriority.some((id) => !variants.some((item) => item.id === id))) {
    invalid("variantPriority", "引用了不存在的变体");
  }
  const normalizedFiles = Object.fromEntries(
    Object.entries(files).map(([name, hash]) => {
      const normalized = text(hash, `source.files.${name}`).toLowerCase();
      if (!SHA256_PATTERN.test(normalized)) invalid(`source.files.${name}`, "必须是 SHA-256");
      return [name, normalized];
    })
  );
  return {
    schemaVersion: 1,
    minSdkVersion: text(candidate.minSdkVersion, "minSdkVersion"),
    model: {
      architecture: text(model.architecture, "model.architecture"),
      id: text(model.id, "model.id"),
      modelType: text(model.modelType, "model.modelType"),
      parameterCount: nonNegativeIntegerOrNull(model.parameterCount, "model.parameterCount"),
      version: text(model.version, "model.version")
    },
    input,
    outputs: candidate.outputs.map((item, index) => tensor(item, `outputs[${index}]`, true)),
    preprocessing: {
      doNormalize: boolean(preprocessing.doNormalize, "preprocessing.doNormalize"),
      doRescale: boolean(preprocessing.doRescale, "preprocessing.doRescale"),
      doResize: boolean(preprocessing.doResize, "preprocessing.doResize"),
      ...(resizeMode(preprocessing.resizeMode, "preprocessing.resizeMode") === undefined
        ? {}
        : { resizeMode: resizeMode(preprocessing.resizeMode, "preprocessing.resizeMode") }),
      ...(preprocessingInterpolation === undefined
        ? {}
        : { interpolation: preprocessingInterpolation }),
      imageMean: triple(preprocessing.imageMean, "preprocessing.imageMean"),
      imageStd: triple(preprocessing.imageStd, "preprocessing.imageStd", true),
      resample: preprocessingResample,
      rescaleFactor: finite(preprocessing.rescaleFactor, "preprocessing.rescaleFactor"),
      size: {
        height: integer(size.height, "preprocessing.size.height"),
        width: integer(size.width, "preprocessing.size.width")
      }
    },
    source: {
      files: normalizedFiles,
      license: text(source.license, "source.license"),
      name: text(source.name, "source.name"),
      url: url(source.url, "source.url")
    },
    labels,
    variantPriority,
    variants
  };
}

function sourceKind(downloadUrl: string): ModelSourceKind {
  const hostname = new URL(downloadUrl).hostname.toLowerCase();
  if (hostname.includes("huggingface.co")) return "huggingface";
  if (hostname.includes("modelscope")) return "modelscope";
  return "custom";
}

export function adaptModelManifest(manifest: ModelManifest): RuntimeDetectionManifest {
  const preprocessingResample = resample(manifest.preprocessing.resample, "preprocessing.resample");
  const priority = new Map(manifest.variantPriority.map((id, index) => [id, index]));
  const variants = [...manifest.variants].sort(
    (left, right) =>
      (priority.get(left.id) ?? manifest.variantPriority.length + manifest.variants.indexOf(left)) -
      (priority.get(right.id) ?? manifest.variantPriority.length + manifest.variants.indexOf(right))
  );
  return parseDetectionManifest({
    schemaVersion: 1,
    model: { id: manifest.model.id, version: manifest.model.version },
    input: manifest.input,
    outputs: manifest.outputs,
    preprocessing: {
      size: manifest.preprocessing.size,
      rescaleFactor: manifest.preprocessing.rescaleFactor,
      doResize: manifest.preprocessing.doResize,
      resizeMode: manifest.preprocessing.resizeMode,
      interpolation:
        manifest.preprocessing.interpolation ??
        (preprocessingResample === 3 ? "bicubic" : "bilinear"),
      doRescale: manifest.preprocessing.doRescale,
      doNormalize: manifest.preprocessing.doNormalize,
      mean: manifest.preprocessing.imageMean,
      std: manifest.preprocessing.imageStd
    },
    postprocessing: { type: "nms", scoreThreshold: 0.5, iouThreshold: 0.5 },
    labels: manifest.labels,
    variants: variants.map((variant) => ({
      id: variant.id,
      precision: variant.precision,
      quantization: variant.quantization ?? null,
      opset: variant.opset,
      bytes: variant.bytes,
      parameterCount: manifest.model.parameterCount,
      backends: variant.backendCompatibility,
      status: variant.validation.included && variant.validation.pass ? "stable" : "blocked",
      sources: [
        {
          kind: sourceKind(variant.url),
          repository: manifest.source.url,
          revision: variant.sha256,
          path: variant.filename,
          downloadUrl: variant.url,
          bytes: variant.bytes,
          sha256: variant.sha256
        }
      ]
    }))
  });
}
