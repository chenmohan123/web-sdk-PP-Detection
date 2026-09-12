import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd(),
  out = process.argv[2];
const conversion = JSON.parse(readFileSync(join(out, "conversion.json"), "utf8"));
conversion.candidates["weight-only-stem-fp32"] = JSON.parse(
  readFileSync(join(out, "conversion-weight-only.json"), "utf8")
);
Object.assign(
  conversion.candidates,
  JSON.parse(readFileSync(join(out, "conversion-stem.json"), "utf8")).candidates
);
for (const [name, file] of [
  ["fp32", join(root, "models/pp-detection/picodet-l-320-fp32.onnx")],
  ["fp32-prepared", join(out, "models/fp32-prepared.onnx")],
  ...Object.keys(conversion.candidates)
    .filter((n) => conversion.candidates[n].status === "converted")
    .map((n) => [n, join(out, "models", n + ".onnx")])
]) {
  const b = readFileSync(file),
    sha = createHash("sha256").update(b).digest("hex"),
    int8 = !name.startsWith("fp32");
  const m = JSON.parse(readFileSync("models/pp-detection/manifest.json", "utf8"));
  m.status = "labs";
  m.model.version = "1.0.1-int8-probe." + (int8 ? (name.startsWith("qdq") ? "1" : "2") : "0");
  m.defaultVariant = int8 ? "int8" : "fp32";
  m.defaultSource = "custom";
  m.variants = [
    {
      ...m.variants[0],
      id: m.defaultVariant,
      filename: basename(file),
      precision: m.defaultVariant,
      quantization: name.startsWith("weight-only")
        ? "weight-only-int8-activation-fp32"
        : int8
          ? name
          : "none",
      opset: name === "fp32" ? 11 : 13,
      bytes: b.length,
      sha256: sha,
      status: "labs",
      sources: [
        {
          kind: "custom",
          repository: "local://picodet-int8-probe",
          revision: sha,
          path: basename(file),
          downloadUrl: "http://localhost/model/model.onnx",
          bytes: b.length,
          sha256: sha
        }
      ]
    }
  ];
  m.limitations = [
    "本清单仅为本地可行性实验；backends 是请求矩阵，不是兼容性承诺。",
    "尚未完成移动端或峰值内存验证。"
  ];
  writeFileSync(join(out, name + "-manifest.json"), JSON.stringify(m, null, 2) + "\n");
}
let runner = readFileSync("tools/model-pipeline/browser/evaluation-runner.mjs", "utf8");
for (const [before, after] of [
  ['resolve(browserDirectory, "../../..")', "resolve(process.cwd())"],
  ['precision: "fp32"', "precision: manifest.variants[0].precision"],
  [
    'await import("playwright")',
    `await import(${JSON.stringify(pathToFileURL(resolve("node_modules/playwright/index.mjs")).href)})`
  ],
  [
    "const page = await browser.newPage();",
    "const page = await browser.newPage();\n    page.setDefaultTimeout(180000);"
  ],
  [
    "const result = await evaluateInBrowser(page, {",
    "const watchdog = setTimeout(() => { browser.close().catch(() => {}); }, 240000);\n    let result;\n    try { result = await evaluateInBrowser(page, {"
  ],
  [
    "origin: server.origin\n    });",
    "origin: server.origin\n    }); } finally { clearTimeout(watchdog); }"
  ]
]) {
  if (runner.split(before).length !== 2) throw Error("探针替换不唯一：" + before);
  runner = runner.replace(before, after);
}
writeFileSync(
  join(out, "browser-probe.mjs"),
  "// 一次性 INT8 探针，复用正式 SDK 与评测流程。\n" + runner
);
console.log("实验清单和浏览器探针已生成");
