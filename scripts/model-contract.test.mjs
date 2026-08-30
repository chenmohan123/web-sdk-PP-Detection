import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const historicalManifestPath = resolve(root, "models/pp-detection/1.0.0/manifest.json");
const stableManifestPath = resolve(root, "models/pp-detection/1.0.1/manifest.json");

test("历史 1.0.0 PicoDet 清单保持 blocked 且不含可发布变体", async () => {
  const manifest = JSON.parse(await readFile(historicalManifestPath, "utf8"));
  assert.equal(manifest.status, "labs/blocked");
  assert.deepEqual(manifest.variants, []);
  assert.match(manifest.blocked.reason, /尚未完成|来源/);
});

test("1.0.1 stable variants cannot claim zero or fabricated integrity metadata", async () => {
  const manifest = JSON.parse(await readFile(stableManifestPath, "utf8"));
  assert.equal(manifest.status, "stable");
  assert.equal(manifest.defaultVariant, "fp32");
  for (const variant of manifest.variants) {
    assert.ok(Number.isInteger(variant.bytes) && variant.bytes > 0);
    assert.match(variant.sha256, /^[0-9a-f]{64}$/);
    assert.equal(variant.opset, 11);
    assert.ok(Array.isArray(variant.sources) && variant.sources.length >= 3);
    assert.equal(variant.status, "stable");
  }
});
