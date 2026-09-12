import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

// 一次性探针复用正式 runner，只增加变体精度选择和 GPU 特性记录。
const [modelFile, outputDirectory, version = "0.1.0-fp16-probe.2"] = process.argv.slice(2);
if (!modelFile || !outputDirectory)
  throw new Error("用法：node prepare-browser.mjs <模型文件> <输出目录> [实验版本]");
const out = resolve(outputDirectory);
mkdirSync(out, { recursive: true });
const bytes = readFileSync(modelFile);
const sha = createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync("models/ppyoloe-plus-s-640/manifest.json", "utf8"));
manifest.model.version = version;
manifest.status = "labs";
manifest.defaultVariant = "fp16";
manifest.defaultSource = "custom";
manifest.variants = [
  {
    ...manifest.variants[0],
    id: "fp16",
    precision: "fp16",
    status: "labs",
    bytes: bytes.length,
    // 仅声明探针请求矩阵，不是发布兼容性承诺。
    backends: ["wasm", "webgpu"],
    sources: [
      {
        kind: "custom",
        repository: "local://fp16-probe",
        revision: sha,
        path: basename(modelFile),
        downloadUrl: "http://localhost/model/model.onnx",
        bytes: bytes.length,
        sha256: sha
      }
    ]
  }
];
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
let runner = readFileSync("tools/model-pipeline/browser/evaluation-runner.mjs", "utf8");
for (const [before, after] of [
  ['resolve(browserDirectory, "../../..")', "resolve(process.cwd())"],
  ['precision: "fp32"', "precision: manifest.variants[0].precision"],
  [
    "vendor: info.vendor || null",
    "features: [...adapter.features],\n      vendor: info.vendor || null"
  ]
]) {
  if (runner.split(before).length !== 2)
    throw new Error(`正式 runner 已变化，需人工复核：${before}`);
  runner = runner.replace(before, after);
}
writeFileSync(
  join(out, "browser-probe.mjs"),
  "// 一次性 FP16 实验探针，必须在仓库根目录执行。\n" + runner
);
