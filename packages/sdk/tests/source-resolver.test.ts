import { describe, expect, it } from "vitest";
import { resolveModelSources } from "../src/model/source-resolver";
import type { DetectionModelVariant } from "../src/types";

const source = (kind: "huggingface" | "modelscope" | "git-lfs") => ({
  kind,
  repository: "repo",
  revision: kind.repeat(40),
  path: "model.onnx",
  downloadUrl: `https://example.invalid/${kind}/model.onnx?token=private`,
  bytes: 4,
  sha256: "a".repeat(64)
});

const variant: DetectionModelVariant = {
  id: "fp32",
  precision: "fp32",
  quantization: null,
  opset: 11,
  bytes: 4,
  parameterCount: 1,
  backends: ["wasm"],
  sources: [source("huggingface"), source("modelscope"), source("git-lfs")]
};

describe("模型来源解析", () => {
  it("auto 按清单中的来源顺序返回候选", () => {
    expect(resolveModelSources(variant, "auto").map(({ kind }) => kind)).toEqual([
      "huggingface",
      "modelscope",
      "git-lfs"
    ]);
  });

  it("显式来源只返回一个来源", () => {
    expect(resolveModelSources(variant, "modelscope").map(({ kind }) => kind)).toEqual([
      "modelscope"
    ]);
  });

  it("显式来源不存在时返回稳定错误码", () => {
    try {
      resolveModelSources(variant, "custom");
      throw new Error("预期解析失败");
    } catch (error) {
      expect(error).toMatchObject({ code: "MODEL_SOURCE_UNAVAILABLE" });
    }
  });
});
