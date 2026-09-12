import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repositoryRoot = new URL("..", import.meta.url);

describe("documentation contract", () => {
  it("runs the bilingual inventory and generated error-code checks", () => {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["scripts/check-doc-parity.mjs"], {
        cwd: repositoryRoot,
        stdio: "pipe"
      });
    });
  });

  it("描述当前两模型六个 stable 变体和设备证据边界", () => {
    const chineseReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const englishReadme = readFileSync(new URL("README.en.md", repositoryRoot), "utf8");

    for (const document of [chineseReadme, englishReadme]) {
      assert.match(document, /PicoDet.*1\.0\.2/);
      assert.match(document, /PP-YOLOE.*0\.1\.1/);
      assert.match(document, /FP32、FP16、W8A32.*stable/);
      assert.match(document, /小米 15.*仅覆盖原 FP32/);
    }
  });

  it("记录当前默认组合、六变体和 W8A32 API 映射", () => {
    const rootReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const packageReadme = readFileSync(new URL("packages/sdk/README.md", repositoryRoot), "utf8");
    const modelReadme = readFileSync(new URL("models/README.md", repositoryRoot), "utf8");
    const englishModels = readFileSync(new URL("docs/en/models.md", repositoryRoot), "utf8");
    const chineseModels = readFileSync(new URL("docs/zh-CN/models.md", repositoryRoot), "utf8");

    for (const precision of ["FP32", "FP16", "W8A32"]) {
      assert.match(rootReadme, new RegExp(precision));
    }
    for (const document of [packageReadme, modelReadme, englishModels, chineseModels]) {
      assert.match(document, /ModelScope/);
      assert.match(document, /FP32/);
      assert.match(document, /FP16/);
      assert.match(document, /W8A32/);
      assert.match(document, /precision: "int8"/);
    }
  });

  it("records the current model asset gate in both languages", () => {
    const modelReadme = readFileSync(new URL("models/README.md", repositoryRoot), "utf8");
    const englishConversion = readFileSync(
      new URL("docs/en/conversion.md", repositoryRoot),
      "utf8"
    );
    const chineseConversion = readFileSync(
      new URL("docs/zh-CN/conversion.md", repositoryRoot),
      "utf8"
    );

    for (const document of [modelReadme, englishConversion, chineseConversion]) {
      assert.match(document, /stable|稳定/);
      assert.match(document, /FP16/);
      assert.match(document, /SHA-256/);
      assert.match(document, /不可变来源|immutable source/is);
    }
  });

  it("documents per-class confidence thresholds in every public API guide", () => {
    const documents = [
      "README.md",
      "README.en.md",
      "packages/sdk/README.md",
      "docs/en/api.md",
      "docs/zh-CN/api.md",
      "docs/en/quick-start.md",
      "docs/zh-CN/quick-start.md"
    ].map((path) => readFileSync(new URL(path, repositoryRoot), "utf8"));

    for (const document of documents) {
      assert.match(document, /classThresholds/);
      assert.match(document, /person/);
      assert.match(document, /car/);
      assert.doesNotMatch(document, /formula:\s*0\.4|table:\s*0\.55|text:\s*0\.6/);
      assert.doesNotMatch(document, /mask binarization|mask 二值化|掩码/i);
    }
  });
});
