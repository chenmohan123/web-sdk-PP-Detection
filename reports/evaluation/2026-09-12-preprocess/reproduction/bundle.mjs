// 将基线与当前预处理分别构建成浏览器模块；从仓库根目录运行。
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsup"))("esbuild");
const baselineRef = process.argv[2] ?? "45cf9be";
const directory = process.argv[3] ?? ".tmp/preprocess-micro";
const sourcePath = "packages/sdk/src/detection/preprocess.ts";
mkdirSync(directory, { recursive: true });
for (const name of ["baseline", "candidate"]) {
  const contents =
    name === "baseline"
      ? execFileSync("git", ["show", baselineRef + ":" + sourcePath], { encoding: "utf8" })
      : readFileSync(sourcePath, "utf8");
  await build({
    stdin: {
      contents,
      loader: "ts",
      resolveDir: resolve("packages/sdk/src/detection"),
      sourcefile: name + ".ts"
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: join(directory, name + ".mjs")
  });
}
