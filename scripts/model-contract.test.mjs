import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "models/pp-detection/1.0.0/manifest.json");

test("PicoDet manifest is explicitly blocked until real artifacts exist", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.status, "labs/blocked");
  assert.deepEqual(manifest.variants, []);
  assert.match(manifest.blocked.reason, /真实|工具|权重/);
});

test("stable variants cannot claim zero or fabricated integrity metadata", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const variant of manifest.variants) {
    assert.ok(Number.isInteger(variant.bytes) && variant.bytes > 0);
    assert.match(variant.sha256, /^[0-9a-f]{64}$/);
    assert.equal(variant.opset, 11);
    assert.ok(Array.isArray(variant.sources) && variant.sources.length >= 3);
  }
});
