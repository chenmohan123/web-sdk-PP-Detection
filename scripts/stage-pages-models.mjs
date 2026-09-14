import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
const modelRoot = resolve(repositoryRoot, "models", "pp-detection");
const stableManifestPaths = [
  "pp-detection/1.0.2/manifest.json",
  "ppyoloe-plus-s-640/0.1.1/manifest.json",
  "ppyoloe-plus-m-640/0.1.1/manifest.json",
  "ppyoloe-plus-l-640/0.1.1/manifest.json",
  "ppyoloe-plus-x-640/0.1.1/manifest.json"
];
export const MODEL_VERSION = "1.0.1";
export const MODEL_PUBLIC_ROOT = "https://chenmohan123.github.io/web-sdk-PP-Detection/models";

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

export async function stagePagesModels({
  outputRoot,
  publicRoot = MODEL_PUBLIC_ROOT,
  sourceRoot = modelRoot
}) {
  const manifest = JSON.parse(await readFile(resolve(sourceRoot, "manifest.json"), "utf8"));
  if (manifest.status === "labs/blocked") throw new Error("当前模型清单处于 blocked 状态");
  if (!Array.isArray(manifest.variants) || manifest.variants.length === 0)
    throw new Error("当前模型清单没有可用变体");
  await mkdir(outputRoot, { recursive: true });
  const variants = [];
  for (const variant of manifest.variants) {
    const filename = requireFilename(variant.filename);
    const bytes = await readFile(resolve(sourceRoot, filename));
    if (bytes.byteLength !== variant.bytes) throw new Error(`${filename} byte length mismatch`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== variant.sha256) throw new Error(`${filename} SHA-256 mismatch`);
    await writeFile(resolve(outputRoot, filename), bytes);
    variants.push({ ...variant, url: `${publicRoot}/${filename}` });
  }
  const staged = { ...manifest, variants };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(staged, null, 2)}\n`);
  return staged;
}

export async function stageAllPagesModels({ outputRoot, repository = repositoryRoot }) {
  const manifest = await stagePagesModels({ outputRoot });
  for (const path of stableManifestPaths) {
    const destination = resolve(outputRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(repository, "models", path), destination);
  }
  return [{ manifest, model: { version: manifest.model.version } }];
}

export { stableManifestPaths };

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  await stageAllPagesModels({ outputRoot: resolve(repositoryRoot, "apps/demo/dist/models") });
}
