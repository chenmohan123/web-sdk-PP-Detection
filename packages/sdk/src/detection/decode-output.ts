import { PPDetectionError } from "../errors";
import type { Detection, DetectionBox, TensorContract } from "../types";
import { nonMaximumSuppression, type NmsCandidate } from "./nms";
import type { LetterboxTransform } from "./preprocess";

export interface OutputTensor {
  readonly data: ArrayLike<number>;
  readonly dims?: readonly number[];
}

export interface DecodeDetectionOptions {
  readonly labels: readonly string[];
  readonly scoreThreshold: number;
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly iouThreshold: number;
  readonly transform: LetterboxTransform;
  readonly outputs?: readonly TensorContract[];
  readonly matrixCoordinates?: "pixels" | "normalized";
  readonly queryCoordinates?: "pixels" | "normalized";
  readonly queryBoxFormat?: "cxcywh" | "xyxy";
}

type RawDetection = NmsCandidate;

function tensorMap(value: unknown): Record<string, OutputTensor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PPDetectionError("INFERENCE_FAILED", "模型输出必须是张量映射");
  }
  const outputs = value as Record<string, unknown>;
  for (const [name, tensor] of Object.entries(outputs)) {
    const data = (tensor as { data?: { length?: unknown } } | null)?.data;
    const dims = (tensor as { dims?: unknown } | null)?.dims;
    if (
      typeof tensor !== "object" ||
      tensor === null ||
      !("data" in tensor) ||
      !("dims" in tensor) ||
      !Array.isArray(dims) ||
      dims.length === 0 ||
      !dims.every((dimension) => Number.isInteger(dimension) && (dimension as number) >= 0) ||
      typeof data?.length !== "number" ||
      !Number.isSafeInteger(data.length) ||
      data.length !== dims.reduce((size, dimension) => size * Number(dimension), 1)
    ) {
      throw new PPDetectionError("INFERENCE_FAILED", "模型输出张量结构无效", { name });
    }
  }
  return outputs as Record<string, OutputTensor>;
}

function thresholdFor(classId: number, options: DecodeDetectionOptions): number {
  const label = options.labels[classId] ?? String(classId);
  return options.classThresholds?.[label] ?? options.scoreThreshold;
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function matchesContract(tensor: OutputTensor, contract: TensorContract): boolean {
  return (
    tensor.dims !== undefined &&
    tensor.dims.length === contract.shape.length &&
    tensor.dims.every(
      (dimension, index) => contract.shape[index] === -1 || dimension === contract.shape[index]
    )
  );
}

function declaredTensor(
  outputs: Record<string, OutputTensor>,
  contracts: readonly TensorContract[] | undefined,
  predicate: (contract: TensorContract) => boolean
): OutputTensor | undefined {
  if (contracts === undefined) return undefined;
  const matches = contracts
    .filter(predicate)
    .map((contract) => {
      const tensor = outputs[contract.name];
      return tensor && matchesContract(tensor, contract) ? tensor : undefined;
    })
    .filter((tensor): tensor is OutputTensor => tensor !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

function matrixCandidates(
  outputs: Record<string, OutputTensor>,
  options: DecodeDetectionOptions
): RawDetection[] | undefined {
  let output: OutputTensor | undefined;
  if (options.outputs !== undefined) {
    output = declaredTensor(outputs, options.outputs, (tensor) => tensor.shape.at(-1) === 6);
  } else {
    output = Object.entries(outputs).find(([, tensor]) => tensor.dims?.at(-1) === 6)?.[1];
  }
  if (!output) return undefined;
  const data = output.data;
  const candidates: RawDetection[] = [];
  for (let offset = 0, index = 0; offset + 5 < data.length; offset += 6, index += 1) {
    const classId = Math.trunc(Number(data[offset]));
    const score = Number(data[offset + 1]);
    if (!Number.isFinite(score) || score < thresholdFor(classId, options)) continue;
    const coordinates = [2, 3, 4, 5].map((item) => Number(data[offset + item]));
    if (!coordinates.every(Number.isFinite)) continue;
    const normalized = options.matrixCoordinates === "normalized";
    candidates.push({
      index,
      classId,
      score,
      box: {
        xMin: coordinates[0] * (normalized ? options.transform.inputWidth : 1),
        yMin: coordinates[1] * (normalized ? options.transform.inputHeight : 1),
        xMax: coordinates[2] * (normalized ? options.transform.inputWidth : 1),
        yMax: coordinates[3] * (normalized ? options.transform.inputHeight : 1)
      }
    });
  }
  return candidates;
}

function findOutput(
  outputs: Record<string, OutputTensor>,
  expression: RegExp
): OutputTensor | undefined {
  return Object.entries(outputs).find(([name]) => expression.test(name))?.[1];
}

function queryCandidates(
  outputs: Record<string, OutputTensor>,
  options: DecodeDetectionOptions
): RawDetection[] | undefined {
  const boxes = options.outputs
    ? declaredTensor(outputs, options.outputs, (tensor) => tensor.shape.at(-1) === 4)
    : findOutput(outputs, /pred.*box|boxes/i);
  const declaredLogitCandidates = options.outputs?.filter(
    (tensor) => tensor.shape.at(-1) !== 4 && tensor.shape.at(-1) !== 6 && tensor.shape.length >= 2
  );
  const logits = options.outputs
    ? (declaredTensor(
        outputs,
        declaredLogitCandidates,
        (tensor) =>
          tensor.shape.at(-1) === options.labels.length && !/(?:order|mask|aux)/i.test(tensor.name)
      ) ??
      (declaredLogitCandidates?.length === 1
        ? declaredTensor(outputs, declaredLogitCandidates, () => true)
        : undefined))
    : findOutput(outputs, /logit|score/i);
  if (!logits || !boxes) return undefined;
  const boxCount = Math.floor(boxes.data.length / 4);
  if (boxCount === 0) return [];
  const declaredClasses = logits.dims?.at(-1) ?? Math.floor(logits.data.length / boxCount);
  const classes = Math.min(declaredClasses, options.labels.length);
  if (classes <= 0) return [];
  const candidates: RawDetection[] = [];
  for (let query = 0; query < boxCount; query += 1) {
    let classId = 0;
    let score = -Infinity;
    for (let candidateClass = 0; candidateClass < classes; candidateClass += 1) {
      const candidateScore = sigmoid(Number(logits.data[query * declaredClasses + candidateClass]));
      if (candidateScore > score) {
        score = candidateScore;
        classId = candidateClass;
      }
    }
    if (score < thresholdFor(classId, options)) continue;
    const offset = query * 4;
    const raw = [
      Number(boxes.data[offset]),
      Number(boxes.data[offset + 1]),
      Number(boxes.data[offset + 2]),
      Number(boxes.data[offset + 3])
    ];
    if (!raw.every(Number.isFinite)) continue;
    const normalized = options.queryCoordinates !== "pixels";
    const xScale = normalized ? options.transform.inputWidth : 1;
    const yScale = normalized ? options.transform.inputHeight : 1;
    const xMin = options.queryBoxFormat === "xyxy" ? raw[0] : raw[0] - raw[2] / 2;
    const yMin = options.queryBoxFormat === "xyxy" ? raw[1] : raw[1] - raw[3] / 2;
    const xMax = options.queryBoxFormat === "xyxy" ? raw[2] : raw[0] + raw[2] / 2;
    const yMax = options.queryBoxFormat === "xyxy" ? raw[3] : raw[1] + raw[3] / 2;
    candidates.push({
      index: query,
      classId,
      score,
      box: {
        xMin: xMin * xScale,
        yMin: yMin * yScale,
        xMax: xMax * xScale,
        yMax: yMax * yScale
      }
    });
  }
  return candidates;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function restoreBox(
  box: NmsCandidate["box"],
  transform: LetterboxTransform
): DetectionBox | undefined {
  const scaleX = transform.scaleX ?? transform.scale;
  const scaleY = transform.scaleY ?? transform.scale;
  const xMin = clamp((box.xMin - transform.padLeft) / scaleX, 0, transform.originalWidth);
  const yMin = clamp((box.yMin - transform.padTop) / scaleY, 0, transform.originalHeight);
  const xMax = clamp((box.xMax - transform.padLeft) / scaleX, 0, transform.originalWidth);
  const yMax = clamp((box.yMax - transform.padTop) / scaleY, 0, transform.originalHeight);
  if (xMax <= xMin || yMax <= yMin) return undefined;
  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
    xMin,
    yMin,
    xMax,
    yMax
  };
}

export function decodeDetectionOutputs(
  outputValue: unknown,
  options: DecodeDetectionOptions
): Detection[] {
  const outputs = tensorMap(outputValue);
  const candidates = matrixCandidates(outputs, options) ?? queryCandidates(outputs, options);
  if (!candidates) {
    throw new PPDetectionError("INFERENCE_FAILED", "不支持当前模型的检测输出签名", {
      outputs: Object.keys(outputs)
    });
  }
  const restored = candidates.flatMap((candidate) => {
    const box = restoreBox(candidate.box, options.transform);
    return box ? [{ ...candidate, box }] : [];
  });
  return nonMaximumSuppression(restored, options.iouThreshold).map((candidate) => ({
    index: candidate.index,
    classId: candidate.classId,
    labelId: candidate.classId,
    label: options.labels[candidate.classId] ?? String(candidate.classId),
    score: candidate.score,
    box: candidate.box,
    polygon: [
      { x: candidate.box.xMin, y: candidate.box.yMin },
      { x: candidate.box.xMax, y: candidate.box.yMin },
      { x: candidate.box.xMax, y: candidate.box.yMax },
      { x: candidate.box.xMin, y: candidate.box.yMax }
    ]
  }));
}
