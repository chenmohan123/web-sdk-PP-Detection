// 可行性批次：三个模型在相同SDK、图集和后端下串行运行，避免并行争用。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const [workArg, imageArg, firstRoundArg = "1"] = process.argv.slice(2);
assert(workArg && imageArg, "参数：工作目录 图片目录 [起始轮次]");
const firstRound = Number(firstRoundArg);
assert(Number.isInteger(firstRound) && firstRound >= 1 && firstRound <= 3);
const work = resolve(workArg);
const images = resolve(imageArg);
const sdk = await readFile(resolve(root, "packages/sdk/dist/browser-global.js"));
assert.equal(
  createHash("sha256").update(sdk).digest("hex"),
  "c2b6a9733416571c77c8dc48fa68028251e5d8cccb201047c8387bf9433e1189"
);
const models = [
  ["tiny", resolve(work, "ppyolo-tiny-320-fp32.onnx"), resolve(work, "candidate-manifest.json")],
  [
    "picodet-xs",
    resolve(root, ".tmp/picodet-series/picodet-xs-320-webgpu.onnx"),
    resolve(root, "models/pp-detection/picodet-xs-320/1.0.1/manifest.json")
  ],
  [
    "picodet-s",
    resolve(root, ".tmp/picodet-series/picodet-s-320-webgpu.onnx"),
    resolve(root, "models/pp-detection/picodet-s-320/1.0.1/manifest.json")
  ]
];
for (let round = firstRound; round <= 3; round++) {
  const directory = resolve(work, `round-${round}`);
  await mkdir(directory, { recursive: true });
  for (const [name, model, manifest] of models) {
    for (const backend of ["wasm", "webgpu"]) {
      const output = resolve(directory, `${name}-${backend}.json`);
      const result = spawnSync(
        process.execPath,
        [
          resolve(root, "tools/model-pipeline/browser/evaluation-runner.mjs"),
          "--model",
          model,
          "--manifest",
          manifest,
          "--annotations",
          resolve(root, "reports/evaluation/2026-09-11-ppyoloe/dataset/annotations.json"),
          "--image-root",
          images,
          "--backend",
          backend,
          "--output",
          output
        ],
        { cwd: root, stdio: "inherit" }
      );
      assert.equal(result.status, 0, `第${round}轮${name}/${backend}失败`);
      assert.equal(JSON.parse(await readFile(output, "utf8")).status, "passed");
    }
  }
}
