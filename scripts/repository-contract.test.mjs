import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) =>
  value.slice(1)
);
const sdkRoot = join(root, "packages", "sdk");
const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const tsupCli = join(root, "node_modules", "tsup", "dist", "cli-default.js");

function buildSdk() {
  execFileSync(process.execPath, [tsupCli, "--config", "tsup.config.ts"], {
    cwd: sdkRoot,
    stdio: "pipe"
  });
}

test("根包是私有工作区，SDK 子包是唯一公开发布包", () => {
  const rootPackage = readJson("package.json");
  const sdkPackage = readJson("packages/sdk/package.json");

  assert.equal(rootPackage.private, true);
  assert.equal("files" in rootPackage, false);
  assert.equal("exports" in rootPackage, false);
  assert.equal(sdkPackage.name, "web-sdk-pp-detection");
  assert.notEqual(sdkPackage.private, true);
  assert.equal(sdkPackage.version, "0.1.0");
  assert.equal(sdkPackage.license, "Apache-2.0");
  assert.deepEqual(sdkPackage.files, ["dist"]);
  assert.equal(sdkPackage.exports["."].import, "./dist/index.js");
  assert.equal(sdkPackage.exports["."].types, "./dist/index.d.ts");
  assert.equal(sdkPackage.exports["./inference.worker.js"], "./dist/inference.worker.js");
  assert.equal(existsSync(join(root, "README.md")), true);
  assert.equal(existsSync(join(root, "README.en.md")), true);
  assert.equal(existsSync(join(root, "sdk-manifest.yaml")), true);
});

test("无 manifest 的工厂以 INVALID_MANIFEST 拒绝且不会访问网络", async () => {
  buildSdk();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("测试不应发起网络访问");
  };

  try {
    const sdk = await import(
      `${pathToFileURL(join(sdkRoot, "dist", "index.js")).href}?contract=${Date.now()}`
    );
    await assert.rejects(
      async () => sdk.createPPDetection(),
      (error) => error instanceof sdk.PPDetectionError && error.code === "INVALID_MANIFEST"
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manifest 记录 1.0.1 FP32 stable 资产且不伪造 runtime 稳定变体", () => {
  const manifest = readFileSync(join(root, "sdk-manifest.yaml"), "utf8");
  const model = manifest.slice(
    manifest.indexOf("\nmodel:\n"),
    manifest.indexOf("\nperformance:\n")
  );

  assert.match(manifest, /^\s*defaultVariant:\s*\S+/m);
  assert.match(manifest, /^\s*defaultSource:\s*\S+/m);
  assert.match(model, /^\s*assets:\s*$/m);
  assert.match(model, /version:\s*1\.0\.1/);
  assert.match(model, /bytes:\s*23243834/);
  assert.match(model, /sha256:\s*0397bb449689d1bf57dfcb8849b3ddaa1c8962e1e63e533bd97d265908a428a1/);
  assert.match(
    model,
    /url:\s*https:\/\/huggingface\.co\/chenmohan\/web-sdk-pp-detection\/resolve\//
  );
  assert.match(model, /^\s*defaultVariant:\s*fp32/m);
  assert.match(model, /^\s*defaultSource:\s*huggingface/m);
});

test("五类示例统一为 planned 并指向后续目录", () => {
  const manifest = readFileSync(join(root, "sdk-manifest.yaml"), "utf8");
  const expectedPaths = [
    "examples/vanilla",
    "examples/react",
    "examples/vite",
    "examples/cdn",
    "examples/wechat-web-view"
  ];

  for (const examplePath of expectedPaths) {
    assert.match(
      manifest,
      new RegExp(`status: planned, path: ${examplePath.replaceAll("/", "\\/")}`)
    );
  }
});
