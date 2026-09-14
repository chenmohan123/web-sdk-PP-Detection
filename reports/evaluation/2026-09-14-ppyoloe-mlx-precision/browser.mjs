import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "../../../tools/model-pipeline/browser/evaluation-runner.mjs";

const report = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(report, "../../..");
const work = resolve(root, ".tmp/precision-mlx-20260914");
const jobs = JSON.parse(await readFile(resolve(report, "jobs.json"), "utf8"));
const fileDigest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
// 串行测量，避免不同模型或后端争用计算资源。
for (const job of jobs) {
  const manifestSha256 = await fileDigest(resolve(root, job.manifest));
  for (const backend of ["wasm", "webgpu"]) {
    const output = resolve(work, `${job.size}-${job.precision}-${backend}.json`);
    let previous;
    try {
      previous = JSON.parse(await readFile(output, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (previous?.status === "passed") {
      assert.equal(previous.artifacts.model.sha256, job.sha256);
      assert.equal(previous.artifacts.manifest.sha256, manifestSha256);
      assert.equal(
        previous.artifacts.sdk.sha256,
        await fileDigest(resolve(root, "packages/sdk/dist/browser-global.js"))
      );
      assert.equal(
        previous.artifacts.annotations.sha256,
        await fileDigest(
          resolve(root, "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json")
        )
      );
      assert.equal(previous.images.length, 64);
      console.log(`${job.size}/${job.precision}/${backend}：复用本轮完整输出`);
      continue;
    }
    console.log(`${job.size}/${job.precision}/${backend}：开始 64 图`);
    const result = await runEvaluation({
      model: job.model,
      manifest: job.manifest,
      annotations: "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json",
      imageRoot: ".tmp/phase2/dataset/images",
      expectedImages: 64,
      backend,
      precision: job.precision === "w8a32" ? "int8" : job.precision,
      output
    });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "passed") throw new Error(`${output}：${result.status}`);
    assert.equal(result.model.bytes, job.bytes);
    assert.equal(result.artifacts.model.sha256, job.sha256);
    assert.equal(result.artifacts.manifest.sha256, manifestSha256);
    console.log(`${job.size}/${job.precision}/${backend}：完成`);
  }
}
