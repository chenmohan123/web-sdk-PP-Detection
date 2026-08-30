import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
export const MODEL_VERSION = "1.0.1";
export const MODEL_RELEASE_ROOT =
  "https://github.com/chenmohan123/web-sdk-PP-Detection/releases/download/v1.0.1-models";
export const MODEL_PUBLIC_ROOT =
  "https://chenmohan123.github.io/web-sdk-PP-Detection/models/v1.0.1";
export const PAGE_MODEL_RELEASES = [{ version: "1.0.1", releaseRoot: MODEL_RELEASE_ROOT }];

async function requireOk(response, url) {
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  return response;
}

function requireFilename(filename) {
  if (
    typeof filename !== "string" ||
    filename !== filename.split(/[\\/]/u).at(-1) ||
    !/^[A-Za-z0-9._-]+\.onnx$/u.test(filename)
  ) {
    throw new Error(`Unsafe or unexpected model filename: ${String(filename)}`);
  }
  return filename;
}

function requireAssetUrl(value, filename) {
  if (typeof value !== "string") {
    throw new Error(`Unsafe or unexpected model URL: ${String(value)}`);
  }
  const url = new URL(value);
  const expectedPath = new RegExp(
    `^/chenmohan123/web-sdk-PP-Detection/releases/download/v\\d+\\.\\d+\\.\\d+-models/${filename}$`
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !expectedPath.test(url.pathname)
  ) {
    throw new Error(`Unsafe or unexpected model URL: ${value}`);
  }
  return url.href;
}

function sourceDownloadUrl(variant) {
  if (typeof variant.url === "string") return variant.url;
  const source = variant.sources?.find(({ kind }) => kind === "git-lfs") ?? variant.sources?.[0];
  return source?.downloadUrl;
}

function isBlockedManifest(manifest) {
  return manifest?.status === "labs/blocked";
}

async function readBundledManifest() {
  const path = resolve(repositoryRoot, `models/pp-detection/${MODEL_VERSION}/manifest.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function stagePagesModels({
  fetchImpl = fetch,
  outputRoot,
  publicRoot,
  releaseRoot,
  manifest: suppliedManifest
}) {
  let manifest = suppliedManifest;
  if (manifest === undefined) {
    if (releaseRoot === undefined) {
      throw new Error("当前 PicoDet stable 模型缺少不可变发布地址");
    }
    const manifestUrl = `${releaseRoot}/manifest.json`;
    const manifestResponse = await requireOk(await fetchImpl(manifestUrl), manifestUrl);
    manifest = await manifestResponse.json();
  }
  if (isBlockedManifest(manifest)) {
    await mkdir(outputRoot, { recursive: true });
    await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
  if (!Array.isArray(manifest.variants) || manifest.variants.length === 0) {
    throw new Error("Model release must contain at least one variant");
  }
  if (publicRoot === undefined) throw new Error("稳定模型暂存必须提供 publicRoot");

  await mkdir(outputRoot, { recursive: true });
  const variants = [];
  for (const variant of manifest.variants) {
    const filename = requireFilename(variant.filename);
    const assetUrl = requireAssetUrl(sourceDownloadUrl(variant), filename);
    const response = await requireOk(await fetchImpl(assetUrl), assetUrl);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== variant.bytes) {
      throw new Error(`${filename} byte length mismatch`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== variant.sha256) throw new Error(`${filename} SHA-256 mismatch`);
    await writeFile(resolve(outputRoot, filename), bytes);
    variants.push({ ...variant, url: `${publicRoot}/${filename}` });
  }

  const staged = { ...manifest, variants };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(staged, null, 2)}\n`);
  return staged;
}

export async function stageAllPagesModels({ fetchImpl = fetch, outputRoot }) {
  const bundledManifest = await readBundledManifest();
  if (isBlockedManifest(bundledManifest)) {
    await stagePagesModels({
      manifest: bundledManifest,
      outputRoot: resolve(outputRoot, `v${bundledManifest.model?.version ?? MODEL_VERSION}`),
      publicRoot: `https://chenmohan123.github.io/web-sdk-PP-Detection/models/v${bundledManifest.model?.version ?? MODEL_VERSION}`
    });
    return [];
  }
  const staged = [];
  for (const model of PAGE_MODEL_RELEASES) {
    const publicVersion = `v${model.version}`;
    const manifest = await stagePagesModels({
      fetchImpl,
      outputRoot: resolve(outputRoot, publicVersion),
      publicRoot: `https://chenmohan123.github.io/web-sdk-PP-Detection/models/${publicVersion}`,
      releaseRoot: model.releaseRoot
    });
    staged.push({ manifest, model });
  }
  return staged;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  await stageAllPagesModels({
    outputRoot: resolve(repositoryRoot, "apps/demo/dist/models")
  });
}
