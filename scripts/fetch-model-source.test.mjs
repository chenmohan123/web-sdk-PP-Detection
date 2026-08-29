import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fetchModelSource } from "./fetch-model-source.mjs";

const bytes = Buffer.from("tiny model");
const sha256 = createHash("sha256").update(bytes).digest("hex");

function manifest({ blocked = false, hash = sha256, variantHash = sha256 } = {}) {
  return {
    status: blocked ? "labs/blocked" : "stable",
    variants: blocked
      ? []
      : [
          {
            id: "fp32",
            filename: "model.onnx",
            bytes: bytes.length,
            sha256: variantHash,
            sources: [
              {
                kind: "huggingface",
                revision: "a".repeat(40),
                downloadUrl: "https://huggingface.co/model.onnx",
                bytes: bytes.length,
                sha256: hash
              },
              {
                kind: "modelscope",
                revision: "b".repeat(40),
                downloadUrl: "https://modelscope.cn/model.onnx",
                bytes: bytes.length,
                sha256: sha256
              },
              {
                kind: "git-lfs",
                revision: "c".repeat(40),
                downloadUrl: "https://media.githubusercontent.com/model.onnx",
                bytes: bytes.length,
                sha256: sha256
              }
            ]
          }
        ]
  };
}

async function withServer(manifestValue, handler, options = {}) {
  const server = createServer((request, response) => {
    if (request.url === "/manifest.json") {
      const payload = Buffer.from(JSON.stringify(manifestValue));
      response.writeHead(200, {
        "content-length": payload.length,
        "content-type": "application/json"
      });
      response.end(payload);
      return;
    }
    if (request.url?.startsWith("/model")) {
      options.modelRequests?.push(request.url);
      const modelStatus =
        options.modelStatusByKind?.[request.headers["x-source-kind"]] ?? options.modelStatus;
      if (modelStatus !== undefined) {
        response.writeHead(modelStatus).end();
        return;
      }
      response.writeHead(200, {
        "content-length": options.contentLength ?? bytes.length,
        "content-type": "application/octet-stream"
      });
      response.end(bytes);
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, {
        location: options.redirectLocation ?? "http://evil.example/model.onnx"
      });
      response.end();
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  if (options.localSources) {
    for (const variant of manifestValue.variants ?? []) {
      for (const source of variant.sources ?? []) {
        source.downloadUrl = `${origin}/${variant.filename}`;
      }
    }
  }
  const sourceKinds = new Set(["huggingface", "modelscope", "git-lfs"]);
  const defaultFetch = fetch;
  const fetchImpl = async (url, requestOptions = {}) => {
    const parsed = new URL(url);
    const sourceKind = [...sourceKinds].find((kind) =>
      manifestValue.variants?.some((variant) =>
        variant.sources?.some(
          (source) =>
            source.kind === kind && new URL(source.downloadUrl).hostname === parsed.hostname
        )
      )
    );
    if (sourceKind !== undefined) {
      const headers = new Headers(requestOptions.headers);
      headers.set("x-source-kind", sourceKind);
      return defaultFetch(`${origin}${parsed.pathname}`, { ...requestOptions, headers });
    }
    return defaultFetch(url, requestOptions);
  };
  try {
    return await handler(origin, fetchImpl);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("downloads and verifies the requested source without credentials", async () => {
  await withServer(manifest({}), async (origin, fetchImpl) => {
    const result = await fetchModelSource({
      manifestUrl: `${origin}/manifest.json`,
      source: "huggingface",
      fetchImpl
    });
    assert.equal(result.sourceKind, "huggingface");
    assert.equal(result.sha256, sha256);
    assert.deepEqual(await readFile(result.modelPath), bytes);
    assert.deepEqual((await readdir(dirname(result.manifestPath))).sort(), [
      "manifest.json",
      "model.onnx"
    ]);
    await result.cleanup();
  });
});

test("explicit source failure does not try another source", async () => {
  const modelRequests = [];
  await withServer(
    manifest({}),
    async (origin, fetchImpl) => {
      await assert.rejects(
        fetchModelSource({
          fetchImpl,
          manifestUrl: `${origin}/manifest.json`,
          source: "huggingface"
        }),
        /HTTP 503/
      );
    },
    { modelRequests, modelStatus: 503 }
  );
  assert.equal(modelRequests.length, 1);
});

test("auto source falls back in manifest order after integrity failure", async () => {
  const modelRequests = [];
  await withServer(
    manifest({}),
    async (origin, fetchImpl) => {
      const result = await fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "auto"
      });
      assert.equal(result.sourceKind, "modelscope");
      await result.cleanup();
    },
    { modelRequests, modelStatusByKind: { huggingface: 503 } }
  );
  assert.equal(modelRequests.length, 2);
});

test("blocked manifest is rejected before model download", async () => {
  await withServer(manifest({ blocked: true }), async (origin) => {
    await assert.rejects(fetchModelSource({ manifestUrl: `${origin}/manifest.json` }), /blocked/);
  });
});

test("non-2xx model response is rejected", async () => {
  await withServer(
    manifest({}),
    async (origin, fetchImpl) => {
      await assert.rejects(
        fetchModelSource({
          fetchImpl,
          manifestUrl: `${origin}/manifest.json`,
          source: "huggingface"
        }),
        /HTTP 503/
      );
    },
    { modelStatus: 503 }
  );
});

test("redirect to a non-HTTPS host is rejected", async () => {
  const value = manifest({});
  value.variants[0].sources[0].downloadUrl = "https://huggingface.co/redirect";
  await withServer(value, async (origin, fetchImpl) => {
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /重定向不是允许的 HTTPS/
    );
  });
});

test("manifest source is required for the requested source", async () => {
  const value = manifest({});
  value.variants[0].sources = value.variants[0].sources.filter(
    ({ kind }) => kind !== "huggingface"
  );
  await withServer(value, async (origin, fetchImpl) => {
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /缺少请求的来源/
    );
  });
});

test("Content-Length mismatch is rejected", async () => {
  await withServer(manifest({}), async (origin, serverFetch) => {
    const fetchImpl = async (url, options) => {
      const response = await serverFetch(url, options);
      if (!url.endsWith("/model.onnx")) return response;
      return new Response(bytes, {
        headers: {
          "content-length": String(bytes.length + 1),
          "content-type": "application/octet-stream"
        },
        status: 200
      });
    };
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /Content-Length/
    );
  });
});

test("missing Content-Length is rejected", async () => {
  await withServer(manifest({}), async (origin, serverFetch) => {
    const fetchImpl = async (url, options) => {
      const response = await serverFetch(url, options);
      if (!url.endsWith("/model.onnx")) return response;
      return new Response(bytes, { status: 200 });
    };
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /缺少 Content-Length/
    );
  });
});

test("remote manifest cannot make a model request to localhost", async () => {
  const value = manifest({});
  value.variants[0].sources[0].downloadUrl = "http://127.0.0.1:9/private.onnx";
  let modelRequests = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/manifest.json")) {
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }
    modelRequests += 1;
    throw new Error("本地来源不应发起请求");
  };
  await assert.rejects(
    fetchModelSource({
      fetchImpl,
      manifestUrl: "https://huggingface.co/manifest.json",
      source: "huggingface"
    }),
    /来源 URL 不允许/
  );
  assert.equal(modelRequests, 0);
});

test("remote manifest cannot use custom HTTPS loopback sources", async () => {
  const value = manifest({});
  value.variants[0].sources[0] = {
    ...value.variants[0].sources[0],
    kind: "custom",
    downloadUrl: "https://127.0.0.1:9/private.onnx"
  };
  let modelRequests = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/manifest.json")) {
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }
    modelRequests += 1;
    throw new Error("回环来源不应发起请求");
  };
  await assert.rejects(
    fetchModelSource({
      fetchImpl,
      manifestUrl: "https://huggingface.co/manifest.json",
      source: "custom"
    }),
    /来源 URL 不允许/
  );
  assert.equal(modelRequests, 0);
});

test("Hugging Face CDN redirects remain allowed", async () => {
  const value = manifest({});
  const fetchImpl = async (url) => {
    if (url.endsWith("/manifest.json")) {
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }
    if (url === "https://huggingface.co/model.onnx") {
      return new Response(null, {
        headers: { location: "https://cdn-lfs.hf.co/model.onnx" },
        status: 302
      });
    }
    return new Response(bytes, {
      headers: { "content-length": String(bytes.length) },
      status: 200
    });
  };
  const result = await fetchModelSource({
    fetchImpl,
    manifestUrl: "https://huggingface.co/manifest.json",
    source: "huggingface"
  });
  assert.equal(result.sourceKind, "huggingface");
  await result.cleanup();
});

test("standard source kinds cannot point to another distribution host", async () => {
  const value = manifest({});
  value.variants[0].sources[0].downloadUrl = "https://modelscope.cn/model.onnx";
  await withServer(value, async (origin, fetchImpl) => {
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /来源 URL 不允许/
    );
  });
});

test("variant summary must match every selected source", async () => {
  const value = manifest({ variantHash: "0".repeat(64) });
  await withServer(value, async (origin, fetchImpl) => {
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /source\.sha256 与变体不一致/
    );
  });
});

test("redirect loops are bounded", async () => {
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    if (url.endsWith("manifest.json")) {
      return new Response(JSON.stringify(manifest({})), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }
    return new Response(null, {
      headers: { location: "https://huggingface.co/model.onnx" },
      status: 302
    });
  };
  await assert.rejects(
    fetchModelSource({
      fetchImpl,
      manifestUrl: "https://huggingface.co/manifest.json",
      source: "huggingface"
    }),
    /重定向次数过多/
  );
  assert.equal(requests, 7);
});

test("query parameters, URL credentials, and authorization text are removed from errors", async () => {
  await assert.rejects(
    fetchModelSource({
      manifestUrl: "https://huggingface.co/model/resolve/main/manifest.json?token=secret",
      fetchImpl: async () => {
        throw new Error(
          "request failed https://user:password@huggingface.co/model?token=secret Authorization Bearer secret"
        );
      }
    }),
    (error) => !String(error).includes("token=secret") && !String(error).includes("secret")
  );
});

test("manifest and source URLs cannot contain credentials", async () => {
  await assert.rejects(
    fetchModelSource({
      manifestUrl: "https://user:password@huggingface.co/manifest.json",
      fetchImpl: async () => new Response(null, { status: 200 })
    }),
    /manifest URL 不得包含凭据/
  );
  const value = manifest({});
  value.variants[0].sources[0].downloadUrl = "https://user:password@huggingface.co/model.onnx";
  await withServer(value, async (origin, fetchImpl) => {
    await assert.rejects(
      fetchModelSource({
        fetchImpl,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /来源 URL 不得包含凭据/
    );
  });
  const redirectValue = manifest({});
  await withServer(redirectValue, async (origin, fetchImpl) => {
    const redirectFetch = async (url, options) => {
      if (url.endsWith("/model.onnx")) {
        return new Response(null, {
          headers: { location: "https://user:password@huggingface.co/model.onnx" },
          status: 302
        });
      }
      return fetchImpl(url, options);
    };
    await assert.rejects(
      fetchModelSource({
        fetchImpl: redirectFetch,
        manifestUrl: `${origin}/manifest.json`,
        source: "huggingface"
      }),
      /重定向不是允许的 HTTPS/
    );
  });
});

test("CLI output includes the verified model and sanitized manifest", async () => {
  const value = manifest({});
  await withServer(
    value,
    async (origin) => {
      const outputDirectory = await mkdtemp(join(tmpdir(), "pp-detection-model-output-"));
      try {
        const result = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["scripts/fetch-model-source.mjs"], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              PPDETECTION_MODEL_MANIFEST_URL: `${origin}/manifest.json`,
              PPDETECTION_MODEL_OUTPUT_DIR: outputDirectory,
              PPDETECTION_MODEL_SOURCE: "huggingface"
            },
            stdio: ["ignore", "pipe", "pipe"]
          });
          let stderr = "";
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("close", (status) => resolve({ status, stderr }));
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual((await readdir(outputDirectory)).sort(), ["manifest.json", "model.onnx"]);
        assert.deepEqual(
          JSON.parse(await readFile(`${outputDirectory}/manifest.json`, "utf8")),
          value
        );
      } finally {
        await rm(outputDirectory, { force: true, recursive: true });
      }
    },
    { localSources: true }
  );
});

test("CLI output includes every variant from a multi-variant manifest", async () => {
  const value = manifest({});
  value.variants.push({
    ...structuredClone(value.variants[0]),
    filename: "model-fp16.onnx",
    id: "fp16"
  });
  await withServer(
    value,
    async (origin) => {
      const outputDirectory = await mkdtemp(join(tmpdir(), "pp-detection-model-output-"));
      try {
        const result = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["scripts/fetch-model-source.mjs"], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              PPDETECTION_MODEL_MANIFEST_URL: `${origin}/manifest.json`,
              PPDETECTION_MODEL_OUTPUT_DIR: outputDirectory,
              PPDETECTION_MODEL_SOURCE: "huggingface",
              PPDETECTION_MODEL_VARIANT: ""
            },
            stdio: ["ignore", "pipe", "pipe"]
          });
          let stderr = "";
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("close", (status) => resolve({ status, stderr }));
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual((await readdir(outputDirectory)).sort(), [
          "manifest.json",
          "model-fp16.onnx",
          "model.onnx"
        ]);
      } finally {
        await rm(outputDirectory, { force: true, recursive: true });
      }
    },
    { localSources: true }
  );
});
