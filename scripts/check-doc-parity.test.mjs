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

  it("describes blocked bundled defaults without inventing an asset version", () => {
    const chineseReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const englishReadme = readFileSync(new URL("README.en.md", repositoryRoot), "utf8");

    assert.match(chineseReadme, /默认模型清单仍为 `labs\/blocked`/);
    assert.match(englishReadme, /PicoDet manifest is still `labs\/blocked`/);
  });

  it("documents only the validated default backend and precision pairs", () => {
    const rootReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const packageReadme = readFileSync(new URL("packages/sdk/README.md", repositoryRoot), "utf8");
    const modelReadme = readFileSync(new URL("models/README.md", repositoryRoot), "utf8");
    const englishModels = readFileSync(new URL("docs/en/models.md", repositoryRoot), "utf8");
    const chineseModels = readFileSync(new URL("docs/zh-CN/models.md", repositoryRoot), "utf8");

    assert.match(rootReadme, /FP32、FP16、INT8、INT4、FP8/);
    assert.match(packageReadme, /FP32、FP16、INT8、INT4 和 FP8/);
    assert.match(packageReadme, /FP32, FP16, INT8, INT4, and FP8/);
    assert.match(modelReadme, /FP32、FP16.*blocked/s);
    assert.match(englishModels, /FP32, FP16.*blocked/s);
    assert.match(chineseModels, /FP32、FP16.*blocked/s);
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
      assert.match(document, /blocked/);
      assert.match(document, /SHA-256/);
      assert.match(document, /不可变来源|immutable source/is);
    }
  });

  it("keeps FP16 single-sample evidence distinct from FP32 seven-fixture evidence", () => {
    const documents = [
      readFileSync(new URL("docs/zh-CN/performance.md", repositoryRoot), "utf8"),
      readFileSync(new URL("docs/en/performance.md", repositoryRoot), "utf8")
    ];

    for (const document of documents) {
      assert.match(document, /FP16.*单次样本|FP16.*single sample/is);
      assert.match(document, /FP32.*7 张授权图片|FP32.*seven licensed fixtures/is);
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
      assert.match(document, /formula/);
      assert.match(document, /mask|掩码/i);
    }
  });
});
