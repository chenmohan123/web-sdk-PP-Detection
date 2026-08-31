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
  test("验证当前 0.1.1 稳定模型清单的静态配置", () => {
    const output = execFileSync(process.execPath, [verifier, "--static"], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });

    assert.match(
      output,
      /Release contract verified: 4 workflows, 1 model variants, model 1\.0\.1\./
    );
  });

  test("1.0.1 稳定清单只发布 FP32 变体并固定三类来源", () => {
    const manifest = JSON.parse(read("models/pp-detection/1.0.1/manifest.json"));

    assert.equal(manifest.status, "stable");
    assert.equal(manifest.variants.length, 1);
    const [variant] = manifest.variants;
    assert.equal(variant.id, "fp32");
    assert.equal(variant.precision, "fp32");
    assert.equal(variant.quantization, "none");
    assert.deepEqual(variant.backends, ["wasm", "webgpu"]);
    assert.equal(variant.bytes, 23243834);
    assert.equal(
      variant.sha256,
      "0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1"
    );
    assert.deepEqual(variant.sources.map(({ kind }) => kind).sort(), [
      "git-lfs",
      "huggingface",
      "modelscope"
    ]);
    for (const source of variant.sources) {
      assert.equal(source.bytes, variant.bytes);
      assert.equal(source.sha256, variant.sha256);
    }
  });

  test("1.0.1 模型校验不因缺少 FP16 变体而阻塞", () => {
    const result = runVerifier("--models", "1.0.1");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /1 model variants, model 1\.0\.1\./);
    assert.doesNotMatch(result.stderr, /FP16|fp16/);
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

    assert.match(workflow, /default:\s*["']?1\.0\.1/);
    assert.match(workflow, /default:\s*["']?v1\.0\.1-models/);
    assert.doesNotMatch(workflow, /default:\s*["']?1\.0\.0/);
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

  test("物理 WebGPU runner 请求当前 PicoDet 清单的 FP32 变体", () => {
    const ci = read(".github/workflows/ci.yml");

    assert.match(ci, /PPDETECTION_MODEL_VARIANT:\s*fp32/);
    assert.doesNotMatch(ci, /PPDETECTION_MODEL_VARIANT:\s*fp16/);
  });

  test("benchmark 仅在清单选择 FP16 时运行 FP16 job", () => {
    const benchmark = read(".github/workflows/benchmark.yml");

    assert.match(
      benchmark,
      /webgpu-fp16:\s*\n\s+if: inputs\.run_validation && vars\.PPDETECTION_MODEL_VARIANT == ['"]fp16['"]/s
    );
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
    assert.match(verifierSource, /offline-official-output/);
    assert.match(verifierSource, /不能作为 accepted 模型发布/);
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

  test("npm 发布在校验前还原两份真实模型文件", () => {
    const release = read(".github/workflows/release.yml");

    assert.match(release, /python3 -m http\.server 8765 --directory "\$GITHUB_WORKSPACE"/);
    assert.match(
      release,
      /PPDETECTION_MODEL_MANIFEST_URL: http:\/\/127\.0\.0\.1:8765\/models\/pp-detection\/1\.0\.1\/manifest\.json/
    );
    assert.match(release, /PPDETECTION_MODEL_SOURCE: git-lfs/);
    assert.match(release, /node scripts\/fetch-model-source\.mjs/);
    assert.match(
      release,
      /cp "\$RUNNER_TEMP\/pp-detection-model\/picodet-l-320-fp32\.onnx" models\/pp-detection\/1\.0\.1\/picodet-l-320-fp32\.onnx/
    );
    assert.match(
      release,
      /curl --fail --location --retry 3 --output "\$accepted_model" "https:\/\/media\.githubusercontent\.com\/media\/chenmohan123\/web-sdk-PP-Detection\/50ec35925ca89945dcfc4d13935e65bf054ac741\/models\/pp-detection\/1\.0\.0\/picodet-l-320-fp32\.onnx"/
    );
    assert.match(release, /test "\$\(stat -c '%s' "\$accepted_model"\)" = "23219047"/);
    assert.match(
      release,
      /echo "a7e1fbfe20f07fd7a7567811a4e2670df0595f0fecb885505d7d93466990e982  \$accepted_model" \| sha256sum --check --status/
    );
    assert.match(
      release,
      /cp "\$accepted_model" models\/pp-detection\/1\.0\.0\/picodet-l-320-fp32\.onnx/
    );
  });

  test("package、runtime 和 changelog 版本保持 0.1.1 一致", () => {
    const packageMetadata = JSON.parse(read("packages/sdk/package.json"));
    const runtime = read("packages/sdk/src/index.ts");
    const changelog = read("CHANGELOG.md");

    assert.equal(packageMetadata.version, "0.1.1");
    assert.match(runtime, /CURRENT_SDK_VERSION = "0\.1\.1"/);
    assert.match(changelog, /^## 0\.1\.1$/m);
  });

  test("Pages 暂存脚本在历史模型 blocked 时不访问网络", async () => {
    const { stagePagesModels } = await import("./stage-pages-models.mjs");
    const outputRoot = mkdtempSync(join(tmpdir(), "ppdetection-blocked-pages-"));
    let fetchCalls = 0;
    try {
      const blockedManifest = JSON.parse(read("models/pp-detection/1.0.0/manifest.json"));
      const staged = await stagePagesModels({
        manifest: blockedManifest,
        outputRoot: join(outputRoot, "v1.0.0"),
        publicRoot: "https://chenmohan123.github.io/web-sdk-PP-Detection/models/v1.0.0",
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("blocked 模型不应访问网络");
        }
      });

      assert.deepEqual(staged, blockedManifest);
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
