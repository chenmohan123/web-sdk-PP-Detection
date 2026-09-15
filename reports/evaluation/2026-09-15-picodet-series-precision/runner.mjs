import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "../../../tools/model-pipeline/browser/evaluation-runner.mjs";

const report = dirname(fileURLToPath(import.meta.url));
const root = resolve(report, "../../..");
const work = resolve(root, ".tmp/picodet-series-precision");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const lock = await read(resolve(report, "inputs.lock.json"));
const protocolBytes = await readFile(resolve(report, "protocol.json"));
const protocol = JSON.parse(protocolBytes);
const jobsBytes = await readFile(resolve(report, "jobs.json"));
const jobs = JSON.parse(jobsBytes);
assert.equal(sha(protocolBytes), lock.protocolSha256, "协议发生变化");
assert.equal(sha(jobsBytes), lock.jobsSha256, "jobs 发生变化");
assert.equal(
  sha(await readFile(resolve(root, "packages/sdk/dist/browser-global.js"))),
  lock.sdkSha256,
  "SDK 发生变化"
);
const annotations = "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json";
assert.equal(
  sha(await readFile(resolve(root, annotations))),
  lock.annotationsSha256,
  "标注发生变化"
);
const imageRoot = process.env.PICODET_IMAGE_ROOT || resolve(root, ".tmp/phase2/dataset/images");
for (const item of lock.images)
  assert.equal(sha(await readFile(resolve(imageRoot, item.fileName))), item.sha256, "图片发生变化");
for (const job of jobs) {
  const model = await readFile(resolve(root, job.model));
  assert.equal(model.length, job.bytes);
  assert.equal(sha(model), job.sha256);
  assert.equal(
    sha(await readFile(resolve(root, job.manifest))),
    lock.models[`${job.key}-${job.precision}`].manifestSha256
  );
}
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(
    ["--round", "--key", "--precision"].includes(process.argv[i]) && process.argv[i + 1],
    "参数无效"
  );
  args.set(process.argv[i], process.argv[i + 1]);
}
const rounds = args.has("--round") ? [Number(args.get("--round"))] : protocol.rounds;
assert(
  rounds.every((x) => protocol.rounds.includes(x)),
  "轮次无效"
);
const selected = jobs.filter(
  (j) =>
    (!args.has("--key") || j.key === args.get("--key")) &&
    (!args.has("--precision") || j.precision === args.get("--precision"))
);
assert(selected.length > 0, "没有匹配组合");
const runtimePrecision = (p) => (p === "w8a32" ? "int8" : p);
const seen = new Map();
function validate(value, job, backend, round, raw, binding) {
  assert.equal(value.status, "passed", value.error?.message || "评测未通过");
  assert.deepEqual(binding, { round, protocolSha256: lock.protocolSha256, resultSha256: sha(raw) });
  const env = value.environment;
  assert.deepEqual(
    { cpu: env.cpu, os: env.os, browser: env.browser, runtimeVersions: value.runtimeVersions },
    lock.environment,
    "环境变化"
  );
  const p = runtimePrecision(job.precision);
  assert.equal(value.runtime.requestedBackend, backend);
  assert.equal(value.runtime.backend, backend);
  assert.equal(value.runtime.mode, "main");
  assert.equal(value.runtime.precision, p);
  assert.deepEqual(value.runtime.fallbacks, []);
  assert.equal(value.model.precision, p);
  assert.equal(value.model.variantId, job.precision);
  assert.equal(value.model.bytes, job.bytes);
  const identity = lock.models[`${job.key}-${job.precision}`];
  assert.equal(value.model.id, identity.modelId);
  assert.equal(value.model.version, identity.modelVersion);
  for (const [name, digest] of Object.entries({
    model: job.sha256,
    manifest: identity.manifestSha256,
    sdk: lock.sdkSha256,
    annotations: lock.annotationsSha256
  }))
    assert.equal(value.artifacts[name].sha256, digest);
  assert.equal(value.artifacts.model.bytes, job.bytes);
  assert.equal(value.artifacts.imageCount, 64);
  assert.equal(value.artifacts.imageSetSha256, lock.imageSetSha256);
  assert.deepEqual(
    value.images.map((x) => ({ fileName: x.fileName, imageId: x.imageId, sha256: x.sha256 })),
    lock.images
  );
  assert.deepEqual(value.evaluation, {
    allowExperimental: true,
    allowFallback: false,
    executionMode: "main",
    expectedImages: 64,
    manifestOverrides: { iouThreshold: 1, scoreThreshold: 0.001 },
    numThreads: 1,
    preprocessing: { interpolation: "bicubic", reference: "Pillow bicubic" },
    requestedBackend: backend,
    precision: p,
    scoreThreshold: 0.001
  });
  if (backend === "webgpu") {
    assert.equal(env.gpu.physical, true);
    assert.equal(env.gpu.adapter.isFallbackAdapter, false);
    assert.deepEqual(env.gpu.adapter, lock.gpuAdapter);
  }
  const name = `${job.key}-${job.precision}-${backend}`;
  const prior = seen.get(name) || [];
  const time = Date.parse(value.capturedAt);
  assert(Number.isFinite(time));
  assert(
    prior.every((x) => x.sha !== sha(raw) && x.time < time),
    "跨轮复用或时间倒序"
  );
  seen.set(name, [...prior, { sha: sha(raw), time }]);
}
for (const round of rounds)
  for (const job of selected)
    for (const backend of protocol.backends) {
      const name = `${job.key}-${job.precision}-${backend}`;
      const path = resolve(work, `round-${round}`, `${name}.json`);
      const bindingPath = path.replace(/\.json$/, "-binding.json");
      await mkdir(dirname(path), { recursive: true });
      let existing;
      try {
        existing = await readFile(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (existing) {
        const value = JSON.parse(existing);
        if (value.status === "passed") {
          validate(value, job, backend, round, existing, await read(bindingPath));
          console.log(`第 ${round} 轮 ${name}：复用完整记录`);
          continue;
        }
        // 保存失败原因，再执行同一组合；失败结果不会被重新标记为通过。
        const failurePath = resolve(
          work,
          "failed",
          `round-${round}-${name}-${sha(existing).slice(0, 12)}.json`
        );
        await mkdir(dirname(failurePath), { recursive: true });
        await copyFile(path, failurePath);
      }
      console.log(`第 ${round} 轮 ${name}：开始`);
      const value = await runEvaluation({
        model: job.model,
        manifest: job.manifest,
        annotations,
        imageRoot,
        expectedImages: 64,
        backend,
        precision: runtimePrecision(job.precision),
        output: path
      });
      const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n");
      const binding = { round, protocolSha256: lock.protocolSha256, resultSha256: sha(raw) };
      await writeFile(path, raw);
      await writeFile(bindingPath, JSON.stringify(binding, null, 2) + "\n");
      validate(value, job, backend, round, raw, binding);
      console.log(`第 ${round} 轮 ${name}：通过`);
    }
