import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = resolve(repositoryRoot, "scripts/verify-release.mjs");

function runVerifier(...args) {
  return spawnSync(process.execPath, [verifier, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("发布工作流契约", () => {
  test("验证当前 0.1.0 阻塞模型清单的静态配置", () => {
    const output = execFileSync(process.execPath, [verifier, "--static"], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });

    assert.match(
      output,
      /Release contract verified: 4 workflows, 0 model variants, model 1\.0\.0\./
    );
  });

  test("blocked 清单不携带可发布变体", () => {
    const manifest = JSON.parse(read("models/pp-detection/1.0.0/manifest.json"));

    assert.equal(manifest.status, "labs/blocked");
    assert.deepEqual(manifest.variants, []);
  });

  test("阻止发布 blocked 模型", () => {
    const result = runVerifier("--models", "1.0.0");

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /model 1\.0\.0 is blocked and cannot be released/);
  });

  test("模型工作流默认使用当前版本并拒绝旧版本引用", () => {
    const workflow = read(".github/workflows/model-validation.yml");

    assert.match(workflow, /default:\s*["']?1\.0\.0/);
    assert.match(workflow, /default:\s*["']?v1\.0\.0-models/);
    assert.doesNotMatch(workflow, /1\.0\.[12]/);
    assert.doesNotMatch(workflow, /PP-DocLayout|PPDOCLAYOUT/);
  });

  test("benchmark 和 runtime 工作流使用 PP-Detection 变量", () => {
    const benchmark = read(".github/workflows/benchmark.yml");
    const ci = read(".github/workflows/ci.yml");

    assert.match(benchmark, /PPDETECTION_BENCHMARK_MODE/);
    assert.doesNotMatch(benchmark, /PPDOCLAYOUT|PP-DocLayout/);
    assert.match(ci, /PPDETECTION_REAL_MODEL/);
    assert.doesNotMatch(ci, /PPDOCLAYOUT|PP-DocLayout/);
  });

  test("发布校验要求稳定变体携带三类固定来源", () => {
    const verifierSource = read("scripts/verify-release.mjs");
    assert.match(verifierSource, /huggingface/);
    assert.match(verifierSource, /modelscope/);
    assert.match(verifierSource, /git-lfs/);
    assert.match(verifierSource, /downloadUrl/);
    assert.match(verifierSource, /revision/);
    assert.match(verifierSource, /source\.bytes/);
    assert.match(verifierSource, /source\.sha256/);
  });

  test("发布校验严格限制官方来源主机边界", () => {
    const verifierSource = read("scripts/verify-release.mjs");
    assert.match(verifierSource, /hostname !== "huggingface\.co"/);
    assert.match(verifierSource, /!downloadUrl\.hostname\.endsWith\("\.huggingface\.co"\)/);
    assert.match(verifierSource, /hostname !== "hf\.co"/);
    assert.match(verifierSource, /!downloadUrl\.hostname\.endsWith\("\.hf\.co"\)/);
    assert.match(verifierSource, /hostname !== "modelscope\.cn"/);
    assert.match(verifierSource, /!downloadUrl\.hostname\.endsWith\("\.modelscope\.cn"\)/);
    assert.doesNotMatch(verifierSource, /hostname\.includes\("modelscope"\)/);
  });

  test("所有发布工作流固定 action 主版本和只读默认权限", () => {
    for (const name of ["ci.yml", "pages.yml", "model-validation.yml", "release.yml"]) {
      const source = read(`.github/workflows/${name}`);
      const actions = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(
        (match) => match[1]
      );
      assert.ok(actions.length > 0, `${name} 必须使用 action`);
      for (const action of actions) assert.match(action, /@v\d+$/);
      assert.match(source, /^permissions:\s*\n\s+contents:\s+read\s*$/m);
      assert.match(source, /node-version-file:\s*["']?\.nvmrc/);
      assert.match(source, /version:\s*["']?11\.16\.0/);
    }
  });

  test("npm 发布使用 Trusted Publishing，不回退到 token", () => {
    const release = read(".github/workflows/release.yml");

    assert.match(release, /environment:\s*npm/);
    assert.match(release, /id-token:\s+write/);
    assert.match(release, /npm publish --access public --provenance/);
    assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
  });

  test("package、runtime 和 changelog 版本保持 0.1.0 一致", () => {
    const packageMetadata = JSON.parse(read("packages/sdk/package.json"));
    const runtime = read("packages/sdk/src/index.ts");
    const changelog = read("CHANGELOG.md");

    assert.equal(packageMetadata.version, "0.1.0");
    assert.match(runtime, /CURRENT_SDK_VERSION = "0\.1\.0"/);
    assert.match(changelog, /^## 0\.1\.0$/m);
  });

  test("Pages 暂存脚本在模型 blocked 时不访问网络", async () => {
    const { stageAllPagesModels } = await import("./stage-pages-models.mjs");
    const outputRoot = mkdtempSync(join(tmpdir(), "ppdetection-blocked-pages-"));
    let fetchCalls = 0;
    try {
      const staged = await stageAllPagesModels({
        outputRoot,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("blocked 模型不应访问网络");
        }
      });

      assert.deepEqual(staged, []);
      assert.equal(fetchCalls, 0);
      const versionDirectory = join(outputRoot, "v1.0.0");
      assert.deepEqual(
        JSON.parse(readFileSync(join(versionDirectory, "manifest.json"), "utf8")),
        JSON.parse(read("models/pp-detection/1.0.0/manifest.json"))
      );
      assert.deepEqual(readdirSync(versionDirectory), ["manifest.json"]);
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });
});
