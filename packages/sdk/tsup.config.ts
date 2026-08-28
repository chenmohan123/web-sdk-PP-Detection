import { defineConfig } from "tsup";

const shared = {
  outDir: "dist",
  platform: "browser" as const,
  sourcemap: true,
  target: "es2022" as const,
  treeshake: true
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    dts: true,
    entry: { index: "src/index.ts" },
    format: ["esm"],
    splitting: false
  },
  {
    ...shared,
    clean: false,
    dts: false,
    entry: { "inference.worker": "src/worker/inference.worker.ts" },
    format: ["esm"],
    noExternal: ["onnxruntime-web"],
    splitting: false
  },
  {
    ...shared,
    clean: false,
    dts: false,
    entry: { "browser-global": "src/browser-global.ts" },
    format: ["iife"],
    globalName: "PPDetection",
    noExternal: ["onnxruntime-web"],
    outExtension: () => ({ js: ".js" }),
    splitting: false
  }
]);
