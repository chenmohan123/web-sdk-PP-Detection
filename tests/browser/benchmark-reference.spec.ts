import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "playwright/test";

import {
  loadOfflineOfficialReference,
  validateOfflineOfficialReference,
  type OfflineOfficialReference
} from "./benchmark-reference";

const fixtureNames = [
  "curved-document.jpg",
  "doc-formula.png",
  "image-layout.jpg",
  "layout-demo.jpg",
  "screen-photo.jpg",
  "skew-document.jpg",
  "table.png"
] as const;

const officialModel = {
  id: "pp-picodet-l-320",
  version: "1.0.0",
  revision: "206730a8453b23db94898500f47f8ea14426b23d",
  bytes: 23226341,
  sha256: "f602c83aeea1ef65d226cdd272a6b2e603a67dfd97c8ace6acc906c73bff5d89"
};

const fixtureLock = JSON.parse(
  readFileSync(resolve(__dirname, "../../tools/model-pipeline/fixtures/fixtures.lock.json"), "utf8")
) as {
  fixtures: Array<{ filename: string; width: number; height: number; sha256: string }>;
};

function minimalReference(): OfflineOfficialReference {
  return {
    schemaVersion: 1,
    type: "offline-official-output",
    generatedAt: "2026-08-29T00:00:00.000Z",
    generator: {
      script: "tools/model-pipeline/picodet/build_official_reference.py",
      runtime: "onnxruntime 1.28.0"
    },
    model: {
      id: "pp-picodet-l-320",
      version: "1.0.0",
      repository: "PaddlePaddle/PaddleDetection",
      revision: "206730a8453b23db94898500f47f8ea14426b23d",
      path: "work/picodet-l-320-postprocessed.onnx",
      bytes: officialModel.bytes,
      sha256: officialModel.sha256
    },
    preprocessing: {
      inputSize: { width: 320, height: 320 },
      resizeMode: "stretch",
      interpolation: "bicubic",
      rescaleFactor: 0.00392156862745098,
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      coordinateSpace: "original-pixels"
    },
    fixtures: fixtureNames.map((filename) => ({
      filename,
      width: 1,
      height: 1,
      sha256: "a".repeat(64),
      detections: []
    }))
  };
}

test("离线官方 reference 覆盖锁定的七张 fixture 并保留官方模型摘要", async () => {
  const reference = await loadOfflineOfficialReference("tests/fixtures/does-not-exist.json", {
    readFile: async () => JSON.stringify(minimalReference())
  });

  expect(reference.type).toBe("offline-official-output");
  expect(reference.model.sha256).toBe(officialModel.sha256);
  expect(reference.fixtures.map(({ filename }) => filename)).toEqual(fixtureNames);
});

test("仓库中的离线官方 reference 可通过完整校验", async () => {
  const reference = await loadOfflineOfficialReference(
    "tools/model-pipeline/references/picodet-l-320-official-output.json",
    {
      validation: {
        fixtureNames,
        officialModel,
        expectedFixtures: fixtureLock.fixtures
      }
    }
  );

  expect(reference.fixtures).toHaveLength(7);
  expect(reference.fixtures.some(({ detections }) => detections.length > 0)).toBe(true);
});

test("离线官方 reference 拒绝与 candidate 相同的模型摘要", () => {
  const reference = minimalReference();
  expect(() =>
    validateOfflineOfficialReference(reference, {
      fixtureNames,
      officialModel,
      candidateModelSha256: officialModel.sha256
    })
  ).toThrow(/candidate.*SHA/i);
});

test("离线官方 reference 拒绝缺少 fixture 或非官方类型", () => {
  const reference = minimalReference();
  reference.type = "candidate-output" as never;
  reference.fixtures = reference.fixtures.slice(0, -1);

  expect(() =>
    validateOfflineOfficialReference(reference, { fixtureNames, officialModel })
  ).toThrow(/offline-official-output|fixture/i);
});

test("离线官方 reference 拒绝不匹配的官方模型 revision", () => {
  const reference = minimalReference();
  reference.model.revision = "0000000000000000000000000000000000000000";

  expect(() =>
    validateOfflineOfficialReference(reference, { fixtureNames, officialModel })
  ).toThrow(/revision/i);
});

test("离线官方 reference 拒绝与 fixture lock 不一致的摘要", async () => {
  const raw = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../tools/model-pipeline/references/picodet-l-320-official-output.json"
      ),
      "utf8"
    )
  ) as ReturnType<typeof minimalReference>;
  raw.fixtures[0]!.sha256 = "a".repeat(64);

  expect(() =>
    validateOfflineOfficialReference(raw, {
      fixtureNames,
      officialModel,
      expectedFixtures: fixtureLock.fixtures
    })
  ).toThrow(/fixture.*SHA|lock/i);
});
