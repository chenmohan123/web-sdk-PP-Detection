import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const sources = {
  react: "src/App.tsx",
  vue: "src/App.vue",
  "vanilla-vite": "src/main.ts",
  "wechat-webview": "src/main.ts",
  vanilla: "main.js",
  cdn: "index.html"
};
for (const [name, entry] of Object.entries(sources)) {
  test(`${name} 明确当前模型、来源和取消生命周期`, () => {
    const source = readFileSync(new URL(`../examples/${name}/${entry}`, import.meta.url), "utf8");
    assert.match(source, /model:\s*(?:manifestUrl|"https:\/\/www\.modelscope\.cn)/u);
    assert.match(source, /source:\s*"modelscope"/u);
    assert.match(source, /AbortController/u);
    assert.match(source, /signal:/u);
    assert.doesNotMatch(source, /models\.example\.com|@latest|file:\.\.\/\.\.\/packages/u);
  });
  if (!["vanilla", "cdn"].includes(name)) {
    test(`${name} 原样复制使用公开固定 SDK`, () => {
      const pkg = JSON.parse(
        readFileSync(new URL(`../examples/${name}/package.json`, import.meta.url), "utf8")
      );
      assert.equal(pkg.dependencies["web-sdk-pp-detection"], "0.1.1");
      assert.ok(pkg.scripts.dev && pkg.scripts.build);
    });
  }
}
