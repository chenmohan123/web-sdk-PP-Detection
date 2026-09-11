import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAdapter,
  parseEvaluationOptions,
  summarizeWarmRuns,
  validateCategoryMapping
} from "./evaluation-runner.mjs";

test("类别映射保留非连续 ID 并拒绝标签顺序错误", () => {
  const categories = [
    { id: 9, name: "boat" },
    { id: 1, name: "person" }
  ];
  assert.deepEqual(validateCategoryMapping(["person", "boat"], categories), [1, 9]);
  assert.throws(() => validateCategoryMapping(["boat", "person"], categories), /标签.*顺序/u);
});

test("评测参数要求模型、清单、标注、图片目录、后端和输出路径", () => {
  const options = parseEvaluationOptions([
    "--model",
    "candidate.onnx",
    "--manifest",
    "manifest.json",
    "--annotations",
    "annotations.json",
    "--image-root",
    "images",
    "--backend",
    "wasm",
    "--output",
    "result.json"
  ]);

  assert.deepEqual(options, {
    annotations: "annotations.json",
    backend: "wasm",
    expectedImages: 64,
    imageRoot: "images",
    manifest: "manifest.json",
    model: "candidate.onnx",
    output: "result.json"
  });
  assert.throws(() => parseEvaluationOptions(["--model", "candidate.onnx"]), /缺少必填参数/u);
  assert.throws(
    () =>
      parseEvaluationOptions([
        "--model",
        "candidate.onnx",
        "--manifest",
        "manifest.json",
        "--annotations",
        "annotations.json",
        "--image-root",
        "images",
        "--backend",
        "auto",
        "--output",
        "result.json"
      ]),
    /backend 只能是 wasm 或 webgpu/u
  );
});

test("热统计排除第一张并按线性插值计算 median 与 p90", () => {
  const summary = summarizeWarmRuns([
    { wallClockMs: 999 },
    { wallClockMs: 10 },
    { wallClockMs: 20 },
    { wallClockMs: 30 },
    { wallClockMs: 40 }
  ]);

  assert.deepEqual(summary, {
    count: 4,
    medianMs: 25,
    p90Ms: 37
  });
});

test("物理 GPU 判定拒绝回退和已知软件适配器", () => {
  assert.deepEqual(
    classifyAdapter({
      description: "NVIDIA GeForce RTX 4090",
      device: "0x2684",
      isFallbackAdapter: false,
      vendor: "0x10de"
    }),
    { physical: true, reason: null }
  );
  assert.deepEqual(
    classifyAdapter({
      architecture: "d3d12",
      description: "",
      device: "",
      isFallbackAdapter: null,
      vendor: "nvidia"
    }),
    { physical: true, reason: null }
  );
  assert.deepEqual(
    classifyAdapter({
      description: "Google SwiftShader",
      device: "0x0000",
      isFallbackAdapter: false,
      vendor: "0x1ae0"
    }),
    { physical: false, reason: "检测到软件适配器" }
  );
  assert.deepEqual(
    classifyAdapter({
      description: "",
      device: "",
      isFallbackAdapter: null,
      vendor: ""
    }),
    { physical: false, reason: "适配器身份信息不足" }
  );
});
