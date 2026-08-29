import { readFile } from "node:fs/promises";

import type { DetectionForParity } from "./benchmark-parity";

export interface OfflineOfficialFixture {
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly detections: DetectionForParity[];
}

export interface OfflineOfficialReference {
  readonly schemaVersion: 1;
  readonly type: "offline-official-output";
  readonly generatedAt: string;
  readonly generator: {
    readonly script: string;
    readonly runtime: string;
  };
  readonly model: {
    readonly id: string;
    readonly version: string;
    readonly repository: string;
    readonly revision: string;
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly preprocessing: {
    readonly inputSize: { readonly width: number; readonly height: number };
    readonly resizeMode: "stretch";
    readonly interpolation: "bicubic";
    readonly rescaleFactor: number;
    readonly mean: readonly number[];
    readonly std: readonly number[];
    readonly coordinateSpace: "original-pixels";
  };
  readonly fixtures: readonly OfflineOfficialFixture[];
}

export interface OfflineOfficialReferenceValidationOptions {
  readonly fixtureNames: readonly string[];
  readonly officialModel: Pick<
    OfflineOfficialReference["model"],
    "id" | "version" | "revision" | "bytes" | "sha256"
  >;
  readonly candidateModelSha256?: string;
  readonly expectedFixtures?: readonly Readonly<{
    filename: string;
    width: number;
    height: number;
    sha256: string;
  }>[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`离线官方 reference ${message}`);
}

function finiteNumber(value: unknown, path: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `${path} 必须是有限数值`);
  return value;
}

function validateDetection(value: unknown, path: string): DetectionForParity {
  assert(isRecord(value), `${path} 必须是对象`);
  const box = value.box;
  const polygon = value.polygon;
  assert(isRecord(box), `${path}.box 必须是对象`);
  assert(Array.isArray(polygon) && polygon.length > 0, `${path}.polygon 不能为空`);
  const detection = {
    box: {
      xMin: finiteNumber(box.xMin, `${path}.box.xMin`),
      yMin: finiteNumber(box.yMin, `${path}.box.yMin`),
      xMax: finiteNumber(box.xMax, `${path}.box.xMax`),
      yMax: finiteNumber(box.yMax, `${path}.box.yMax`)
    },
    labelId: finiteNumber(value.labelId, `${path}.labelId`),
    polygon: polygon.map((point, index) => {
      assert(isRecord(point), `${path}.polygon[${index}] 必须是对象`);
      return {
        x: finiteNumber(point.x, `${path}.polygon[${index}].x`),
        y: finiteNumber(point.y, `${path}.polygon[${index}].y`)
      };
    }),
    readingOrder: finiteNumber(value.readingOrder, `${path}.readingOrder`),
    score: finiteNumber(value.score, `${path}.score`)
  };
  return detection;
}

export function validateOfflineOfficialReference(
  value: unknown,
  options: OfflineOfficialReferenceValidationOptions
): OfflineOfficialReference {
  assert(isRecord(value), "根节点必须是对象");
  assert(value.schemaVersion === 1, "schemaVersion 必须是 1");
  assert(value.type === "offline-official-output", "type 必须是 offline-official-output");
  assert(typeof value.generatedAt === "string" && value.generatedAt.length > 0, "generatedAt 缺失");

  const generator = value.generator;
  assert(isRecord(generator), "generator 缺失");
  assert(
    typeof generator.script === "string" && generator.script.length > 0,
    "generator.script 缺失"
  );
  assert(
    typeof generator.runtime === "string" && generator.runtime.length > 0,
    "generator.runtime 缺失"
  );

  const model = value.model;
  assert(isRecord(model), "model 缺失");
  assert(typeof model.id === "string" && model.id.length > 0, "model.id 缺失");
  assert(typeof model.version === "string" && model.version.length > 0, "model.version 缺失");
  assert(
    typeof model.repository === "string" && model.repository.length > 0,
    "model.repository 缺失"
  );
  assert(
    typeof model.revision === "string" && REVISION_PATTERN.test(model.revision),
    "model.revision 无效"
  );
  assert(typeof model.path === "string" && model.path.length > 0, "model.path 缺失");
  assert(Number.isSafeInteger(model.bytes) && model.bytes > 0, "model.bytes 无效");
  assert(
    typeof model.sha256 === "string" && SHA256_PATTERN.test(model.sha256),
    "model.sha256 无效"
  );
  assert(model.id === options.officialModel.id, "官方模型 id 与期望值不一致");
  assert(model.version === options.officialModel.version, "官方模型版本与期望值不一致");
  assert(
    model.revision.toLowerCase() === options.officialModel.revision.toLowerCase(),
    "官方模型 revision 与期望值不一致"
  );
  assert(model.bytes === options.officialModel.bytes, "官方模型 bytes 与期望值不一致");
  assert(
    model.sha256.toLowerCase() === options.officialModel.sha256.toLowerCase(),
    "官方模型 SHA-256 与期望值不一致"
  );
  assert(
    options.candidateModelSha256 === undefined ||
      options.candidateModelSha256.toLowerCase() !== model.sha256.toLowerCase(),
    "candidate 模型不得与官方 reference 使用同一 SHA-256"
  );

  const preprocessing = value.preprocessing;
  assert(isRecord(preprocessing), "preprocessing 缺失");
  const inputSize = preprocessing.inputSize;
  assert(isRecord(inputSize), "preprocessing.inputSize 缺失");
  assert(
    Number.isSafeInteger(inputSize.width) && inputSize.width > 0,
    "preprocessing.inputSize.width 无效"
  );
  assert(
    Number.isSafeInteger(inputSize.height) && inputSize.height > 0,
    "preprocessing.inputSize.height 无效"
  );
  assert(preprocessing.resizeMode === "stretch", "preprocessing.resizeMode 必须是 stretch");
  assert(preprocessing.interpolation === "bicubic", "preprocessing.interpolation 必须是 bicubic");
  assert(
    typeof preprocessing.rescaleFactor === "number" && preprocessing.rescaleFactor > 0,
    "preprocessing.rescaleFactor 无效"
  );
  for (const field of ["mean", "std"] as const) {
    assert(
      Array.isArray(preprocessing[field]) &&
        preprocessing[field].length === 3 &&
        preprocessing[field].every((item) => typeof item === "number" && Number.isFinite(item)),
      `preprocessing.${field} 无效`
    );
  }
  assert(
    preprocessing.coordinateSpace === "original-pixels",
    "preprocessing.coordinateSpace 必须是 original-pixels"
  );

  assert(Array.isArray(value.fixtures), "fixtures 必须是数组");
  assert(value.fixtures.length === options.fixtureNames.length, "fixture 数量不完整");
  const fixtures = value.fixtures.map((fixture, index) => {
    assert(isRecord(fixture), `fixtures[${index}] 必须是对象`);
    assert(
      fixture.filename === options.fixtureNames[index],
      `fixtures[${index}] 顺序或文件名不正确`
    );
    assert(
      Number.isSafeInteger(fixture.width) && fixture.width > 0,
      `fixtures[${index}].width 无效`
    );
    assert(
      Number.isSafeInteger(fixture.height) && fixture.height > 0,
      `fixtures[${index}].height 无效`
    );
    assert(
      typeof fixture.sha256 === "string" && SHA256_PATTERN.test(fixture.sha256),
      `fixtures[${index}].sha256 无效`
    );
    const expectedFixture = options.expectedFixtures?.[index];
    if (expectedFixture !== undefined) {
      assert(
        fixture.filename === expectedFixture.filename,
        `fixtures[${index}] 与 lock 文件名不一致`
      );
      assert(fixture.width === expectedFixture.width, `fixtures[${index}] 与 lock 宽度不一致`);
      assert(fixture.height === expectedFixture.height, `fixtures[${index}] 与 lock 高度不一致`);
      assert(
        fixture.sha256.toLowerCase() === expectedFixture.sha256.toLowerCase(),
        `fixtures[${index}] 与 lock SHA-256 不一致`
      );
    }
    assert(Array.isArray(fixture.detections), `fixtures[${index}].detections 必须是数组`);
    return {
      filename: fixture.filename,
      width: fixture.width,
      height: fixture.height,
      sha256: fixture.sha256,
      detections: fixture.detections.map((detection, detectionIndex) =>
        validateDetection(detection, `fixtures[${index}].detections[${detectionIndex}]`)
      )
    } as OfflineOfficialFixture;
  });

  return {
    schemaVersion: 1,
    type: "offline-official-output",
    generatedAt: value.generatedAt,
    generator: { script: generator.script, runtime: generator.runtime },
    model: {
      id: model.id,
      version: model.version,
      repository: model.repository,
      revision: model.revision,
      path: model.path,
      bytes: model.bytes,
      sha256: model.sha256
    },
    preprocessing: {
      inputSize: { width: inputSize.width, height: inputSize.height },
      resizeMode: "stretch",
      interpolation: "bicubic",
      rescaleFactor: preprocessing.rescaleFactor,
      mean: [...preprocessing.mean],
      std: [...preprocessing.std],
      coordinateSpace: "original-pixels"
    },
    fixtures
  };
}

export async function loadOfflineOfficialReference(
  path: string,
  options: {
    readFile?: (path: string, encoding: "utf8") => Promise<string>;
    validation?: OfflineOfficialReferenceValidationOptions;
  } = {}
): Promise<OfflineOfficialReference> {
  const read = options.readFile ?? ((filePath, encoding) => readFile(filePath, encoding));
  const raw = await read(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `离线官方 reference JSON 无效：${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (options.validation === undefined) {
    assert(
      isRecord(value) && value.type === "offline-official-output",
      "缺少 offline-official-output 类型标记"
    );
    return value as OfflineOfficialReference;
  }
  return validateOfflineOfficialReference(value, options.validation);
}
