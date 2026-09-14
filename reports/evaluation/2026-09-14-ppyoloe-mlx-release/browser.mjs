import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { runEvaluation } from "../../../tools/model-pipeline/browser/evaluation-runner.mjs";

const ROUND1_COMMIT = "e4814a44d42be5e213ef416cd0dfb2d7932c2340";
const execFileAsync = promisify(execFile);
const report = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(report, "../../..");
const protocolBytes = await readFile(resolve(report, "protocol.json"));
const protocol = JSON.parse(protocolBytes);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const protocolSha256 = sha(protocolBytes);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEqual(actual, expected, message) {
  requireCondition(Object.is(actual, expected), `${message}：${actual} !== ${expected}`);
}

function requireDeepEqual(actual, expected, message) {
  requireCondition(isDeepStrictEqual(actual, expected), message);
}

function safePath(base, relative, label) {
  requireCondition(typeof relative === "string" && relative.length > 0, `${label} 路径无效`);
  requireCondition(!isAbsolute(relative), `${label} 不得使用绝对路径`);
  const target = resolve(base, relative);
  requireCondition(target.startsWith(`${resolve(base)}${sep}`), `${label} 越出证据目录：${relative}`);
  return target;
}

const fileSha = async (path) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};

function requireUniqueAxis(matrix, name) {
  const values = matrix[name];
  requireCondition(Array.isArray(values) && values.length > 0, `matrix.${name} 必须是非空数组`);
  requireEqual(new Set(values).size, values.length, `matrix.${name} 存在重复值`);
  return values;
}

function sameMembers(actual, expected) {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function runtimePrecision(precision) {
  requireCondition(["fp32", "fp16", "w8a32"].includes(precision), `不支持的精度：${precision}`);
  return precision === "w8a32" ? "int8" : precision;
}

function validateProtocolAndJobs(value, jobs, fixedSummary) {
  requireEqual(value.round1.commit, ROUND1_COMMIT, "第一轮固定提交不匹配");
  const matrix = value.matrix;
  requireCondition(matrix && typeof matrix === "object", "缺少 matrix");
  const sizes = requireUniqueAxis(matrix, "sizes");
  const precisions = requireUniqueAxis(matrix, "precisions");
  const backends = requireUniqueAxis(matrix, "backends");
  const rounds = requireUniqueAxis(matrix, "rounds");
  requireDeepEqual(rounds, [1, 2, 3], "发布证据必须严格包含第 1、2、3 轮");
  requireCondition(precisions.includes("fp32"), "精度轴缺少 fp32 基线");
  requireCondition(backends.every((backend) => ["wasm", "webgpu"].includes(backend)), "后端轴包含不支持的值");
  requireCondition(Number.isInteger(matrix.wasmThreads) && matrix.wasmThreads > 0, "matrix.wasmThreads 必须是正整数");
  requireCondition(typeof matrix.executionMode === "string" && matrix.executionMode.length > 0, "matrix.executionMode 无效");
  requireCondition(typeof matrix.allowFallback === "boolean", "matrix.allowFallback 必须是布尔值");
  requireCondition(Number.isInteger(value.dataset.imageCount) && value.dataset.imageCount > 0, "dataset.imageCount 必须是正整数");
  requireCondition(Number.isFinite(value.qualityGate.scoreThreshold), "qualityGate.scoreThreshold 无效");

  const fixedSizes = Object.keys(fixedSummary.models);
  const fixedPrecisions = Object.keys(fixedSummary.models[fixedSizes[0]]);
  const fixedBackends = Object.keys(
    fixedSummary.models[fixedSizes[0]][fixedPrecisions[0]].backends
  ).filter((backend) => backend !== "python");
  requireCondition(sameMembers(sizes, fixedSizes), "size 轴与固定第一轮摘要不一致");
  requireCondition(sameMembers(precisions, fixedPrecisions), "precision 轴与固定第一轮摘要不一致");
  requireCondition(sameMembers(backends, fixedBackends), "backend 轴与固定第一轮摘要不一致");

  requireCondition(Array.isArray(jobs), "jobs 必须是数组");
  const jobsByKey = new Map();
  for (const job of jobs) {
    const key = `${job.size}\u0000${job.precision}`;
    requireCondition(!jobsByKey.has(key), `jobs 存在重复组合：${job.size}/${job.precision}`);
    jobsByKey.set(key, job);
  }
  const expectedKeys = sizes.flatMap((size) => precisions.map((precision) => `${size}\u0000${precision}`));
  requireEqual(jobsByKey.size, expectedKeys.length, "jobs 数量与 size/precision 笛卡尔积不一致");
  for (const key of expectedKeys) {
    requireCondition(jobsByKey.has(key), `jobs 缺少组合：${key.replace("\u0000", "/")}`);
    const job = jobsByKey.get(key);
    const fixed = fixedSummary.models[job.size][job.precision];
    requireEqual(job.bytes, fixed.bytes, `job bytes 与固定摘要不一致：${job.size}/${job.precision}`);
    requireEqual(job.sha256, fixed.sha256, `job SHA 与固定摘要不一致：${job.size}/${job.precision}`);
  }
  return { backends, precisions, rounds, sizes };
}

function expectedEvaluation(job, backend) {
  return {
    allowExperimental: true,
    allowFallback: protocol.matrix.allowFallback,
    executionMode: protocol.matrix.executionMode,
    expectedImages: protocol.dataset.imageCount,
    manifestOverrides: { iouThreshold: 1, scoreThreshold: 0.001 },
    numThreads: protocol.matrix.wasmThreads,
    preprocessing: { interpolation: "bicubic", reference: "Pillow bicubic" },
    requestedBackend: backend,
    precision: runtimePrecision(job.precision),
    scoreThreshold: 0.001
  };
}

const initial = resolve(root, protocol.round1.report);
const initialSummaryBytes = await readFile(resolve(initial, "summary.json"));
requireEqual(sha(initialSummaryBytes), protocol.round1.summarySha256, "第一轮 summary SHA 不匹配");
const fixedSummary = JSON.parse(initialSummaryBytes);
const indexRelativePath = `${protocol.round1.report.replaceAll("\\", "/")}/artifact-index.json`;
requireCondition(/^[A-Za-z0-9_./-]+$/.test(indexRelativePath), "第一轮索引 Git 路径无效");
const localIndexBytes = await readFile(resolve(initial, "artifact-index.json"));
const { stdout: committedIndexBytes } = await execFileAsync(
  "git",
  ["show", `${ROUND1_COMMIT}:${indexRelativePath}`],
  { cwd: root, encoding: null, maxBuffer: 16 * 1024 * 1024 }
);
requireCondition(
  localIndexBytes.equals(committedIndexBytes),
  "第一轮 artifact-index.json 与固定提交中的同路径文件字节不一致"
);
const round1ArtifactIndexSha256 = sha(committedIndexBytes);
const index = JSON.parse(committedIndexBytes);
requireCondition(Array.isArray(index), "第一轮 artifact-index.json 必须是数组");
const indexedArtifacts = new Map();
for (const entry of index) {
  requireCondition(entry && typeof entry === "object", "第一轮索引条目无效");
  requireCondition(!indexedArtifacts.has(entry.path), `第一轮索引路径重复：${entry.path}`);
  const compressed = await readFile(safePath(initial, entry.path, "第一轮索引条目"));
  requireEqual(sha(compressed), entry.compressedSha256, `第一轮压缩证据 SHA 不匹配：${entry.path}`);
  const data = gunzipSync(compressed);
  requireEqual(data.length, entry.bytes, `第一轮证据字节数不匹配：${entry.path}`);
  requireEqual(sha(data), entry.sha256, `第一轮证据 SHA 不匹配：${entry.path}`);
  indexedArtifacts.set(entry.path, { artifactIndexSha256: round1ArtifactIndexSha256, data });
}

const jobs = JSON.parse(await readFile(resolve(root, protocol.jobs), "utf8"));
const { backends, rounds, sizes, precisions } = validateProtocolAndJobs(protocol, jobs, fixedSummary);
const work = resolve(root, ".tmp/precision-mlx-release-20260914");
const sdkSha256 = await fileSha(resolve(root, "packages/sdk/dist/browser-global.js"));
const references = new Map();
let gpuAdapterIdentity = null;

function validateGpu(value, stem) {
  if (value.runtime.backend !== "webgpu") return;
  const gpu = value.environment?.gpu;
  requireCondition(gpu?.physical === true, `${stem} 未使用物理 WebGPU 适配器`);
  requireCondition(gpu.adapter && typeof gpu.adapter === "object", `${stem} 缺少 WebGPU adapter`);
  for (const field of ["vendor", "architecture", "device", "description", "isFallbackAdapter"])
    requireCondition(Object.hasOwn(gpu.adapter, field), `${stem} adapter 缺少 ${field}`);
  requireEqual(gpu.adapter.isFallbackAdapter, false, `${stem} 使用了 fallback adapter`);
  if (gpuAdapterIdentity === null) gpuAdapterIdentity = structuredClone(gpu.adapter);
  requireDeepEqual(gpu.adapter, gpuAdapterIdentity, `${stem} 的 WebGPU adapter 身份与其他记录不一致`);
}

function validate(value, reference, job, backend, stem) {
  requireEqual(value.status, "passed", `${stem} 状态不是 passed`);
  requireDeepEqual(value.evaluation, expectedEvaluation(job, backend), `${stem} 的 evaluation 与协议不一致`);
  requireDeepEqual(value.runtimeVersions, reference.runtimeVersions, `${stem} 的运行时版本与第一轮不一致`);
  requireEqual(value.runtime.requestedBackend, backend, `${stem} 的请求后端不一致`);
  requireEqual(value.runtime.backend, backend, `${stem} 的实际后端不一致`);
  requireEqual(value.runtime.mode, protocol.matrix.executionMode, `${stem} 的执行模式不一致`);
  if (!protocol.matrix.allowFallback)
    requireDeepEqual(value.runtime.fallbacks, [], `${stem} 发生了协议禁止的回退`);
  requireEqual(value.model.bytes, reference.model.bytes, `${stem} 的模型字节数与第一轮不一致`);
  requireEqual(value.model.precision, runtimePrecision(job.precision), `${stem} 的模型精度不一致`);
  for (const artifact of ["model", "manifest", "annotations", "sdk"])
    requireEqual(
      value.artifacts[artifact].sha256,
      reference.artifacts[artifact].sha256,
      `${stem} 的 ${artifact} SHA 与第一轮不一致`
    );
  requireEqual(value.artifacts.imageSetSha256, reference.artifacts.imageSetSha256, `${stem} 的图片集 SHA 不一致`);
  requireDeepEqual(
    value.images.map((item) => item.imageId),
    reference.images.map((item) => item.imageId),
    `${stem} 的图片顺序与第一轮不一致`
  );
  requireEqual(value.environment.browser.version, reference.environment.browser.version, `${stem} 的浏览器版本不一致`);
  requireDeepEqual(value.environment.cpu, reference.environment.cpu, `${stem} 的 CPU 身份不一致`);
  requireDeepEqual(value.environment.os, reference.environment.os, `${stem} 的操作系统身份不一致`);
  validateGpu(value, stem);
}

for (const size of sizes) {
  for (const precision of precisions) {
    const job = jobs.find((item) => item.size === size && item.precision === precision);
    requireEqual(await fileSha(resolve(root, job.model)), job.sha256, `模型 SHA 不匹配：${size}/${precision}`);
    const manifestSha256 = await fileSha(resolve(root, job.manifest));
    for (const backend of backends) {
      const stem = `${size}-${precision}-${backend}`;
      const path = `evidence/${stem}.json.gz`;
      const archived = indexedArtifacts.get(path);
      requireCondition(archived, `缺少第一轮 ${stem}`);
      requireEqual(
        archived.artifactIndexSha256,
        round1ArtifactIndexSha256,
        `第一轮 ${stem} 未绑定固定 artifact-index.json`
      );
      const value = JSON.parse(archived.data);
      requireEqual(value.status, "passed", `第一轮 ${stem} 状态不是 passed`);
      requireEqual(value.artifacts.sdk.sha256, sdkSha256, `第一轮 ${stem} 的 SDK SHA 不匹配`);
      requireEqual(value.artifacts.model.sha256, job.sha256, `第一轮 ${stem} 的模型 SHA 不匹配`);
      requireEqual(value.artifacts.manifest.sha256, manifestSha256, `第一轮 ${stem} 的 manifest SHA 不匹配`);
      requireEqual(value.artifacts.annotations.sha256, protocol.dataset.sha256, `第一轮 ${stem} 的标注 SHA 不匹配`);
      requireDeepEqual(value.evaluation, expectedEvaluation(job, backend), `第一轮 ${stem} 的 evaluation 与协议不一致`);
      validateGpu(value, `第 1 轮 ${stem}`);
      references.set(stem, { data: archived.data, value });
    }
  }
}

const seenRuns = new Map();
function registerRun(stem, round, data, value) {
  requireCondition(typeof value.capturedAt === "string" && value.capturedAt.length > 0, `第 ${round} 轮 ${stem} 缺少 capturedAt`);
  const capturedTime = Date.parse(value.capturedAt);
  requireCondition(Number.isFinite(capturedTime), `第 ${round} 轮 ${stem} 的 capturedAt 无效`);
  const resultSha256 = sha(data);
  const byRound = seenRuns.get(stem) ?? new Map();
  if (byRound.has(round)) {
    const existing = byRound.get(round);
    requireDeepEqual(
      { capturedAt: value.capturedAt, resultSha256 },
      { capturedAt: existing.capturedAt, resultSha256: existing.resultSha256 },
      `第 ${round} 轮 ${stem} 被重复注册为不同结果`
    );
    return;
  }
  for (const existing of byRound.values()) {
    requireCondition(existing.resultSha256 !== resultSha256, `${stem} 的第 ${existing.round}/${round} 轮结果 SHA 重复`);
    requireCondition(existing.capturedAt !== value.capturedAt, `${stem} 的第 ${existing.round}/${round} 轮 capturedAt 重复`);
  }
  byRound.set(round, { capturedAt: value.capturedAt, capturedTime, resultSha256, round });
  const ordered = [...byRound.values()].sort((left, right) => left.round - right.round);
  for (let index = 1; index < ordered.length; index += 1)
    requireCondition(
      ordered[index].capturedTime > ordered[index - 1].capturedTime,
      `${stem} 的 capturedAt 未按轮次严格递增：第 ${ordered[index - 1].round}/${ordered[index].round} 轮`
    );
  seenRuns.set(stem, byRound);
}

for (const [stem, reference] of references) registerRun(stem, 1, reference.data, reference.value);

async function readRoundRecord(round, stem, reference, job, backend) {
  const directory = resolve(work, `round-${round}`);
  const data = await readFile(resolve(directory, `${stem}.json`));
  const binding = JSON.parse(await readFile(resolve(directory, `${stem}-binding.json`), "utf8"));
  requireDeepEqual(
    binding,
    { round, protocolSha256, resultSha256: sha(data) },
    `第 ${round} 轮 ${stem} 的协议绑定不一致`
  );
  const value = JSON.parse(data);
  validate(value, reference, job, backend, `第 ${round} 轮 ${stem}`);
  registerRun(stem, round, data, value);
}

const requested = process.argv[2] ? [Number(process.argv[2])] : rounds.filter((round) => round !== 1);
requireCondition(
  requested.every((round) => rounds.includes(round) && round !== 1),
  `只能执行协议中的重复轮次：${rounds.filter((round) => round !== 1).join("、")}`
);
for (const round of requested) {
  const directory = resolve(work, `round-${round}`);
  await mkdir(directory, { recursive: true });
  for (const size of sizes) {
    for (const precision of precisions) {
      const job = jobs.find((item) => item.size === size && item.precision === precision);
      for (const backend of backends) {
        const stem = `${size}-${precision}-${backend}`;
        const reference = references.get(stem).value;
        for (const priorRound of rounds.filter((candidate) => candidate > 1 && candidate < round)) {
          if (!seenRuns.get(stem)?.has(priorRound))
            await readRoundRecord(priorRound, stem, reference, job, backend);
        }
        let reused = false;
        try {
          await readRoundRecord(round, stem, reference, job, backend);
          reused = true;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (reused) {
          console.log(`第 ${round} 轮 ${stem}：复用已校验独立完整记录`);
          continue;
        }
        console.log(`第 ${round} 轮 ${stem}：开始 ${protocol.dataset.imageCount} 图`);
        const output = resolve(directory, `${stem}.json`);
        const bindingPath = resolve(directory, `${stem}-binding.json`);
        const result = await runEvaluation({
          model: job.model,
          manifest: job.manifest,
          annotations: protocol.dataset.annotations,
          imageRoot: ".tmp/phase2/dataset/images",
          expectedImages: protocol.dataset.imageCount,
          backend,
          precision: runtimePrecision(job.precision),
          output
        });
        validate(result, reference, job, backend, `第 ${round} 轮 ${stem}`);
        const data = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
        registerRun(stem, round, data, result);
        await writeFile(output, data);
        await writeFile(
          bindingPath,
          `${JSON.stringify({ round, protocolSha256, resultSha256: sha(data) }, null, 2)}\n`
        );
        console.log(`第 ${round} 轮 ${stem}：完成`);
      }
    }
  }
}
