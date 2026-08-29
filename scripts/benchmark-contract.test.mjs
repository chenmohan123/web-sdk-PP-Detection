import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

test("基准工作流默认保持关闭，避免发布前运行不存在的模型资产", () => {
  const workflow = read(".github/workflows/benchmark.yml");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /run_validation:[\s\S]*default:\s*false/);
  assert.match(workflow, /if:\s*inputs\.run_validation/);
  assert.match(workflow, /PPDETECTION_BENCHMARK_MODE:\s*["']?wasm-fp32/);
  assert.match(workflow, /PPDETECTION_BENCHMARK_MODE:\s*["']?webgpu-fp16/);
  assert.match(workflow, /PPDETECTION_BENCHMARK_MODE:\s*["']?webgpu-fp32/);
  assert.doesNotMatch(workflow, /PPDOCLAYOUT|PP-DocLayout/);
});

test("浏览器基准使用可配置模型版本并跳过 blocked 清单", () => {
  const benchmark = read("tests/browser/benchmark.spec.ts");

  assert.match(benchmark, /PPDETECTION_BENCHMARK_MODE/);
  assert.match(benchmark, /PPDETECTION_MODEL_VERSION/);
  assert.match(benchmark, /fetch-model-source\.mjs/);
  assert.match(benchmark, /PPDETECTION_MODEL_MANIFEST_URL/);
  assert.match(benchmark, /sourceKind/);
  assert.match(benchmark, /manifestRevision/);
  assert.match(benchmark, /manifest\.status === "labs\/blocked"/);
  assert.match(benchmark, /缺少经过核验的真实模型输出参考文件/);
  assert.doesNotMatch(benchmark, /PPDOCLAYOUT|PP-DocLayout/);
});

test("模型相关工作流不依赖 Git LFS，并从固定来源下载模型", () => {
  for (const name of ["ci.yml", "benchmark.yml", "model-validation.yml"]) {
    const workflow = read(`.github/workflows/${name}`);
    assert.doesNotMatch(workflow, /lfs:\s*true/);
  }
  const model = read(".github/workflows/model-validation.yml");
  assert.match(model, /fetch-model-source\.mjs/);
  assert.match(model, /PPDETECTION_MODEL_MANIFEST_URL/);
  assert.match(model, /PPDETECTION_MODEL_SOURCE/);
  assert.match(read("scripts/fetch-model-source.mjs"), /copyFile\(downloads\[0\]\.manifestPath/);
});

test("基准包脚本仍覆盖构建和 parity 测试入口", () => {
  const packageMetadata = JSON.parse(read("package.json"));
  const workflow = read(".github/workflows/benchmark.yml");

  assert.equal(
    packageMetadata.scripts["benchmark:parity"],
    "playwright test tests/browser/benchmark-parity.spec.ts"
  );
  assert.match(workflow, /pnpm run benchmark:parity/);
  assert.match(workflow, /tests\/browser\/benchmark\.spec\.ts/);
  assert.match(workflow, /responsive-screenshots/);
});
