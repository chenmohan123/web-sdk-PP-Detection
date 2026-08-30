import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer, type Server } from "node:http";
import { cpus, platform, release } from "node:os";
import { basename, extname, join, normalize, resolve } from "node:path";

import { expect, test } from "playwright/test";

import { evaluateBrowserParity } from "./benchmark-parity";
import {
  loadOfflineOfficialReference,
  validateOfflineOfficialReference,
  type OfflineOfficialReference
} from "./benchmark-reference";

type BenchmarkMode = "wasm-fp32" | "webgpu-fp16" | "webgpu-fp32";

interface BenchmarkManifest {
  model: { version: string; [key: string]: unknown };
  variants: Array<{
    backendCompatibility: string[];
    bytes: number;
    filename: string;
    id: string;
    precision: string;
    sha256: string;
    sources?: Array<{ kind: string; revision: string }>;
    url?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface DownloadedModelSource {
  readonly bytes: number;
  readonly cleanup: () => Promise<void>;
  readonly manifestPath: string;
  readonly modelPath: string;
  readonly revision: string;
  readonly sha256: string;
  readonly sourceKind: string;
  readonly variantId: string;
}

type FetchModelSource = typeof import("../../scripts/fetch-model-source.mjs").fetchModelSource;
let fetchModelSource: FetchModelSource | undefined;

async function getFetchModelSource(): Promise<FetchModelSource> {
  if (fetchModelSource === undefined) {
    fetchModelSource = (await import("../../scripts/fetch-model-source.mjs")).fetchModelSource;
  }
  return fetchModelSource;
}

interface FixtureLock {
  fixtures: Array<{
    filename: string;
    height: number;
    sha256: string;
    width: number;
  }>;
}

const fixtureNames = [
  "curved-document.jpg",
  "doc-formula.png",
  "image-layout.jpg",
  "layout-demo.jpg",
  "screen-photo.jpg",
  "skew-document.jpg",
  "table.png"
] as const;

const officialReferenceModel = {
  id: "pp-picodet-l-320",
  version: "1.0.0",
  revision: "206730a8453b23db94898500f47f8ea14426b23d",
  bytes: 23226341,
  sha256: "f602c83aeea1ef65d226cdd272a6b2e603a67dfd97c8ace6acc906c73bff5d89"
} as const;

const mode = process.env.PPDETECTION_BENCHMARK_MODE as BenchmarkMode | undefined;
const modelVersion = process.env.PPDETECTION_MODEL_VERSION ?? "1.0.0";
const acceptedModelVersion = process.env.PPDETECTION_ACCEPTED_MODEL_VERSION ?? modelVersion;
const requestedSource = process.env.PPDETECTION_MODEL_SOURCE?.trim() || "huggingface";
const acceptedRequestedSource =
  process.env.PPDETECTION_ACCEPTED_MODEL_SOURCE?.trim() || "huggingface";
const externalManifestUrl = process.env.PPDETECTION_MODEL_MANIFEST_URL?.trim() || undefined;
const acceptedExternalManifestUrl =
  process.env.PPDETECTION_ACCEPTED_MODEL_MANIFEST_URL?.trim() || undefined;
const repositoryRoot = resolve(__dirname, "../..");
const acceptedReferencePath = process.env.PPDETECTION_ACCEPTED_REFERENCE_PATH?.trim()
  ? resolve(repositoryRoot, process.env.PPDETECTION_ACCEPTED_REFERENCE_PATH.trim())
  : undefined;
const sdkRoot = join(repositoryRoot, "packages/sdk");
const ortRoot = join(sdkRoot, "node_modules/onnxruntime-web/dist");
const acceptedModelRoot = join(repositoryRoot, `models/pp-detection/${acceptedModelVersion}`);
const candidateModelRoot = join(repositoryRoot, `models/pp-detection/${modelVersion}`);
let reference: OfflineOfficialReference | undefined;
interface TableReference {
  realImage: {
    expected: {
      boxes: number[][];
      labels: number[];
      polygons: number[][][];
      scores: number[];
      targetSize: { height: number; width: number };
    };
  };
}
let tableReference: TableReference | undefined;

function requireReference(): TableReference {
  if (tableReference === undefined) throw new Error("reference fixture is unavailable");
  return tableReference;
}

function tableReferenceFromOffline(referenceValue: OfflineOfficialReference): TableReference {
  const fixture = referenceValue.fixtures.find(({ filename }) => filename === "table.png");
  if (fixture === undefined) throw new Error("离线官方 reference 缺少 table.png");
  return {
    realImage: {
      expected: {
        boxes: fixture.detections.map(({ box }) => [box.xMin, box.yMin, box.xMax, box.yMax]),
        labels: fixture.detections.map(({ labelId }) => labelId),
        polygons: fixture.detections.map(({ polygon }) => polygon.map(({ x, y }) => [x, y])),
        scores: fixture.detections.map(({ score }) => score),
        targetSize: { height: fixture.height, width: fixture.width }
      }
    }
  };
}
const fixtureRoot = join(repositoryRoot, "tools/model-pipeline/fixtures/images");
const fixturesLockPath = join(repositoryRoot, "tools/model-pipeline/fixtures/fixtures.lock.json");
const outputRoot = join(repositoryRoot, "test-results/benchmark");
let origin = "";
let server: Server;
let candidateDownload: DownloadedModelSource | undefined;
let acceptedDownload: DownloadedModelSource | undefined;
let candidateExternalManifest: BenchmarkManifest | undefined;
let acceptedExternalManifest: BenchmarkManifest | undefined;

test.use(mode?.startsWith("webgpu-") ? { channel: "chrome" } : {});

const referenceThresholds = {
  iou: 0.95,
  maxScoreDelta: 0.02,
  meanPolygonPointDistancePixels: 2
} as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadManifest(): BenchmarkManifest {
  return JSON.parse(
    readFileSync(join(acceptedModelRoot, "manifest.json"), "utf8")
  ) as BenchmarkManifest;
}

function localManifest(
  modelRoot: string,
  urlPrefix: "accepted" | "candidate",
  fp32Backends: readonly string[]
): BenchmarkManifest {
  const manifest = structuredClone(loadManifest());
  manifest.model.version = basename(modelRoot);
  for (const variant of manifest.variants) {
    const path = join(modelRoot, variant.filename);
    variant.bytes = statSync(path).size;
    variant.sha256 = sha256File(path);
    variant.url = `${origin}/models/${urlPrefix}/${variant.filename}`;
    variant.sources = (variant.sources ?? []).map((source) => ({
      ...source,
      bytes: variant.bytes,
      sha256: variant.sha256,
      downloadUrl: variant.url
    }));
    if (variant.precision === "fp32") {
      variant.backendCompatibility = [...fp32Backends];
    }
  }
  return manifest;
}

function downloadedManifest(
  manifest: BenchmarkManifest,
  download: DownloadedModelSource,
  backendCompatibility: readonly string[],
  urlPath: string,
  precision: string
): BenchmarkManifest {
  const variant = manifest.variants.find((candidate) => candidate.precision === precision);
  if (!variant) throw new Error(`外部模型清单缺少 ${precision} 变体`);
  const result = structuredClone(manifest);
  result.model.version = modelVersion;
  result.variants = [structuredClone(variant)];
  const selected = result.variants[0]!;
  selected.bytes = download.bytes;
  selected.sha256 = download.sha256;
  selected.url = `${origin}${urlPath}`;
  selected.backendCompatibility = [...backendCompatibility];
  selected.sources = (selected.sources ?? []).map((source) => ({
    ...source,
    bytes: download.bytes,
    sha256: download.sha256,
    downloadUrl: selected.url
  }));
  return result;
}

function verifiedFixtures(): FixtureLock {
  const lock = JSON.parse(readFileSync(fixturesLockPath, "utf8")) as FixtureLock;
  for (const fixture of lock.fixtures) {
    const path = join(fixtureRoot, fixture.filename);
    expect(sha256File(path), `fixture integrity: ${fixture.filename}`).toBe(fixture.sha256);
  }
  return lock;
}

function boxIou(actual: { xMin: number; xMax: number; yMin: number; yMax: number }): number {
  const [xMin, yMin, xMax, yMax] = requireReference().realImage.expected.boxes[0]!;
  const intersectionWidth = Math.max(
    0,
    Math.min(actual.xMax, xMax!) - Math.max(actual.xMin, xMin!)
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(actual.yMax, yMax!) - Math.max(actual.yMin, yMin!)
  );
  const intersection = intersectionWidth * intersectionHeight;
  const actualArea = (actual.xMax - actual.xMin) * (actual.yMax - actual.yMin);
  const expectedArea = (xMax! - xMin!) * (yMax! - yMin!);
  return intersection / (actualArea + expectedArea - intersection);
}

function meanPolygonPointDistance(actual: readonly { x: number; y: number }[]): number {
  const expected = requireReference().realImage.expected.polygons[0]!;
  if (actual.length !== expected.length) return Number.POSITIVE_INFINITY;
  return (
    actual.reduce((sum, point, index) => {
      const [x, y] = expected[index]!;
      return sum + Math.hypot(point.x - x, point.y - y);
    }, 0) / actual.length
  );
}

function runPnpm(args: readonly string[]): void {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  execFileSync(command, commandArgs, { cwd: repositoryRoot, stdio: "pipe" });
}

function resolveAsset(url: string): string | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith("/dist/")) return join(sdkRoot, pathname.slice(1));
  if (pathname.startsWith("/ort/")) return join(ortRoot, basename(pathname));
  if (pathname.startsWith("/models/accepted/")) {
    return join(acceptedModelRoot, basename(pathname));
  }
  if (pathname.startsWith("/models/candidate/")) {
    return join(candidateModelRoot, basename(pathname));
  }
  if (pathname === "/models/external/candidate.onnx") return candidateDownload?.modelPath;
  if (pathname === "/models/external/accepted.onnx") return acceptedDownload?.modelPath;
  if (pathname.startsWith("/fixtures/")) return join(fixtureRoot, basename(pathname));
  return undefined;
}

function contentType(path: string): string {
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".onnx": "application/octet-stream",
      ".png": "image/png",
      ".wasm": "application/wasm"
    }[extname(path)] ?? "application/octet-stream"
  );
}

test.beforeAll(async () => {
  test.skip(
    !["wasm-fp32", "webgpu-fp16", "webgpu-fp32"].includes(mode ?? ""),
    "设置 PPDETECTION_BENCHMARK_MODE 后才运行基准"
  );
  if (mode !== undefined && externalManifestUrl === undefined) {
    throw new Error("真实模型基准需要设置 PPDETECTION_MODEL_MANIFEST_URL");
  }
  const manifestPath = join(candidateModelRoot, "manifest.json");
  let manifest: { status?: string; variants?: unknown[] };
  if (externalManifestUrl !== undefined) {
    const precision = mode?.endsWith("fp32") ? "fp32" : "fp16";
    candidateDownload = await (
      await getFetchModelSource()
    )({
      manifestUrl: externalManifestUrl,
      source: requestedSource,
      variantId: process.env.PPDETECTION_MODEL_VARIANT ?? precision
    });
    candidateExternalManifest = JSON.parse(
      readFileSync(candidateDownload.manifestPath, "utf8")
    ) as BenchmarkManifest;
    manifest = candidateExternalManifest;
    if (acceptedExternalManifestUrl !== undefined) {
      acceptedDownload = await (
        await getFetchModelSource()
      )({
        manifestUrl: acceptedExternalManifestUrl,
        source: acceptedRequestedSource,
        variantId: process.env.PPDETECTION_ACCEPTED_MODEL_VARIANT ?? "fp32"
      });
      acceptedExternalManifest = JSON.parse(
        readFileSync(acceptedDownload.manifestPath, "utf8")
      ) as BenchmarkManifest;
    } else if (acceptedReferencePath !== undefined) {
      reference = await loadOfflineOfficialReference(acceptedReferencePath, {
        validation: {
          fixtureNames,
          officialModel: officialReferenceModel,
          expectedFixtures: JSON.parse(readFileSync(fixturesLockPath, "utf8")).fixtures,
          candidateModelSha256: candidateDownload.sha256
        }
      });
      tableReference = tableReferenceFromOffline(reference);
    } else {
      throw new Error(
        "真实模型基准需要设置 PPDETECTION_ACCEPTED_MODEL_MANIFEST_URL 或 PPDETECTION_ACCEPTED_REFERENCE_PATH"
      );
    }
    if (
      !manifest.variants?.some(
        (variant) => (variant as { precision?: string }).precision === precision
      )
    ) {
      throw new Error(`外部模型清单缺少 ${precision} 变体`);
    }
  } else {
    test.skip(!existsSync(manifestPath), `模型清单不存在: ${manifestPath}`);
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      status?: string;
      variants?: unknown[];
    };
  }
  test.skip(manifest.status === "labs/blocked", `模型 ${modelVersion} 仍处于 blocked 状态`);
  if (acceptedExternalManifestUrl !== undefined && acceptedReferencePath !== undefined) {
    // accepted 模型清单优先，reference 路径仅作为显式备用入口。
    reference = undefined;
  }
  // accepted 模型清单模式直接以 accepted 模型输出作为基线；不能混入其他 SDK 的
  // model-output-reference.json，否则会把无关的 table.png 专用断言带入对照实验。
  if (acceptedExternalManifestUrl === undefined && reference === undefined) {
    throw new Error("缺少经过核验的真实模型输出参考文件");
  }
  runPnpm(["--filter", "web-sdk-pp-detection", "build"]);
  server = createServer((request, response) => {
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html>${
          mode === "wasm-fp32" ? "<script>globalThis.Worker=undefined;</script>" : ""
        }<script src="/dist/browser-global.js"></script>`
      );
      return;
    }
    const asset = resolveAsset(request.url ?? "");
    const safeAsset = asset === undefined ? undefined : normalize(asset);
    if (safeAsset === undefined || !existsSync(safeAsset) || !statSync(safeAsset).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-length": statSync(safeAsset).size,
      "content-type": contentType(safeAsset)
    });
    createReadStream(safeAsset).pipe(response);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Benchmark server failed");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await candidateDownload?.cleanup();
  await acceptedDownload?.cleanup();
  if (server === undefined) return;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error === undefined ? resolveClose() : reject(error)))
  );
});

test("records strict seven-fixture browser evidence", async ({ browser, page }) => {
  test.setTimeout(20 * 60_000);
  const backend = mode === "wasm-fp32" ? "wasm" : "webgpu";
  const precision = mode?.endsWith("fp32") ? "fp32" : "fp16";
  const fixturesLock = verifiedFixtures();
  const acceptedManifest =
    acceptedDownload === undefined || acceptedExternalManifest === undefined
      ? undefined
      : downloadedManifest(
          acceptedExternalManifest,
          acceptedDownload,
          ["wasm"],
          "/models/external/accepted.onnx",
          "fp32"
        );
  const targetManifest =
    candidateDownload === undefined || candidateExternalManifest === undefined
      ? localManifest(candidateModelRoot, "candidate", ["wasm", "webgpu"])
      : downloadedManifest(
          candidateExternalManifest,
          candidateDownload,
          ["wasm", "webgpu"],
          "/models/external/candidate.onnx",
          precision
        );
  const manifestVariant = targetManifest.variants.find(
    (variant) => variant.precision === precision && variant.backendCompatibility.includes(backend)
  );
  expect(manifestVariant).toBeDefined();

  await page.goto(origin);
  const result = await page.evaluate(
    async ({
      acceptedManifest,
      acceptedReferenceFixtures,
      backend,
      fixtures,
      origin: browserOrigin,
      precision,
      targetManifest
    }) => {
      async function sha256(bytes: Uint8Array): Promise<string> {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
      }

      const targetOptions = {
        allowFallback: false,
        backend,
        cache: true,
        model: targetManifest,
        ort: { wasm: { numThreads: 1, paths: `${browserOrigin}/ort/` } },
        precision
      } as const;
      const normalizeDetections = (detections: readonly Record<string, unknown>[]) =>
        detections.map((detection, index) => ({
          ...detection,
          readingOrder: typeof detection.readingOrder === "number" ? detection.readingOrder : index
        }));
      const serializeError = (error: unknown): unknown => {
        if (error instanceof Error) {
          const errorWithDetails = error as Error & {
            cause?: unknown;
            code?: string;
            details?: unknown;
          };
          return {
            cause:
              errorWithDetails.cause === undefined
                ? undefined
                : serializeError(errorWithDetails.cause),
            code: errorWithDetails.code,
            details: errorWithDetails.details,
            message: error.message,
            name: error.name,
            stack: error.stack
          };
        }
        if (typeof error === "object" && error !== null) {
          try {
            return JSON.parse(JSON.stringify(error));
          } catch {
            return String(error);
          }
        }
        return error;
      };

      await window.PPDetection!.clearModelCache();
      let target;
      try {
        target = await window.PPDetection!.createPPDetection(targetOptions);
      } catch (error) {
        const capabilities = await window.PPDetection!.probePPDetectionCapabilities();
        const failure = error as Error & {
          cause?: unknown;
          code?: string;
          details?: { causeMessage?: string };
        };
        throw new Error(
          JSON.stringify({
            capabilities,
            cause: failure.cause instanceof Error ? failure.cause.message : failure.cause,
            causeMessage: failure.details?.causeMessage,
            code: failure.code,
            details: failure.details,
            message: failure.message,
            name: failure.name
          })
        );
      }
      const accepted = acceptedManifest
        ? await window.PPDetection!.createPPDetection({
            allowFallback: false,
            backend: "wasm",
            cache: true,
            model: acceptedManifest,
            ort: { wasm: { numThreads: 1, paths: `${browserOrigin}/ort/` } },
            precision: "fp32"
          })
        : undefined;
      const fixtureResults = [];
      for (const fixture of fixtures) {
        const image = await (await fetch(`${browserOrigin}/fixtures/${fixture.filename}`)).blob();
        const acceptedDetections = accepted
          ? normalizeDetections((await accepted.detect(image, { threshold: 0.5 })).detections)
          : normalizeDetections(
              acceptedReferenceFixtures?.find(({ filename }) => filename === fixture.filename)
                ?.detections ?? []
            );
        let detection;
        try {
          detection = await target.detect(image, { threshold: 0.5 });
        } catch (error) {
          const capabilities = await window.PPDetection!.probePPDetectionCapabilities();
          throw new Error(
            JSON.stringify({
              capabilities,
              error: serializeError(error),
              fixture: fixture.filename,
              mode,
              target: {
                model: target.model,
                runtime: target.runtime
              }
            })
          );
        }
        const detections = normalizeDetections(detection.detections);
        const acceptedDetectionJson = JSON.stringify(acceptedDetections);
        const detectionJson = JSON.stringify(detections);
        const acceptedOutputSha256 = await sha256(new TextEncoder().encode(acceptedDetectionJson));
        const outputSha256 = await sha256(new TextEncoder().encode(detectionJson));
        fixtureResults.push({
          acceptedDetections,
          acceptedOutputSha256,
          detectionCount: detections.length,
          detections,
          expectedDetectionCount: acceptedDetections.length,
          filename: fixture.filename,
          fixtureSha256: fixture.sha256,
          outputSha256,
          timings: detection.timings
        });
      }
      const coldLoad = target.loadTimings;
      const model = target.model;
      const runtime = target.runtime;
      await accepted?.dispose();
      await target.dispose();
      const warm = await window.PPDetection!.createPPDetection(targetOptions);
      const warmLoad = warm.loadTimings;
      await warm.dispose();
      await window.PPDetection!.clearModelCache();

      const adapter =
        backend === "webgpu"
          ? await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
          : undefined;
      const adapterInfo =
        adapter === undefined
          ? null
          : {
              architecture: adapter.info.architecture || null,
              description: adapter.info.description || null,
              device: adapter.info.device || null,
              vendor: adapter.info.vendor || null
            };
      return {
        adapter: adapterInfo,
        adapterFeatures: adapter === undefined ? [] : [...adapter.features].sort(),
        browser: navigator.userAgent,
        fixtures: fixtureResults,
        model,
        runtime,
        timings: { coldLoad, warmLoad }
      };
    },
    {
      acceptedManifest,
      acceptedReferenceFixtures: reference?.fixtures.map(({ filename, detections }) => ({
        filename,
        detections
      })),
      backend,
      fixtures: fixturesLock.fixtures,
      origin,
      precision,
      targetManifest
    }
  );

  expect(result.runtime).toMatchObject({ backend, fallbacks: [], precision });
  expect(result.model.source.sha256).toBe(manifestVariant!.sha256);
  expect(result.fixtures).toHaveLength(fixturesLock.fixtures.length);
  const evaluatedFixtures = result.fixtures.map(
    ({ acceptedDetections, detections, ...fixture }) => ({
      ...fixture,
      ...evaluateBrowserParity(precision, acceptedDetections, detections),
      detections
    })
  );
  const validationErrors = evaluatedFixtures.flatMap((fixture) =>
    fixture.validationErrors.map((message) => `${fixture.filename}: ${message}`)
  );
  const fixtureEvidence = evaluatedFixtures.map(({ detections, ...fixture }) => {
    if (fixture.filename !== "table.png") return fixture;

    if (tableReference === undefined) {
      return { ...fixture, referenceMetrics: null, referenceThresholds };
    }
    const firstDetection = detections[0];
    const expected = requireReference().realImage.expected;
    if (firstDetection === undefined && expected.boxes.length === 0) {
      return { ...fixture, referenceMetrics: null, referenceThresholds };
    }
    if (firstDetection !== undefined && expected.boxes.length === 0) {
      validationErrors.push("table.png: reference expected no detections");
      return { ...fixture, referenceMetrics: null, referenceThresholds };
    }
    if (firstDetection === undefined) {
      validationErrors.push("table.png: expected reference detection is missing");
      return { ...fixture, referenceMetrics: null, referenceThresholds };
    }
    if (firstDetection.labelId !== expected.labels[0]) {
      validationErrors.push("table.png: reference label differs");
    }
    const referenceMetrics = {
      iou: boxIou(firstDetection.box),
      maxScoreDelta: Math.abs(firstDetection.score - expected.scores[0]!),
      meanPolygonPointDistancePixels: meanPolygonPointDistance(firstDetection.polygon)
    };
    if (referenceMetrics.iou < referenceThresholds.iou) {
      validationErrors.push("table.png: reference IoU is below 0.95");
    }
    if (referenceMetrics.maxScoreDelta > referenceThresholds.maxScoreDelta) {
      validationErrors.push("table.png: reference score delta exceeds 0.02");
    }
    if (
      referenceMetrics.meanPolygonPointDistancePixels >
      referenceThresholds.meanPolygonPointDistancePixels
    ) {
      validationErrors.push("table.png: reference polygon distance exceeds 2 px");
    }
    return { ...fixture, referenceMetrics, referenceThresholds };
  });

  const sdkCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).trim();
  const report = {
    schemaVersion: 1,
    status: validationErrors.length === 0 ? "passed" : "failed",
    validationErrors,
    referenceType: reference === undefined ? "accepted-model" : "offline-official-output",
    reference:
      reference === undefined
        ? {
            type: "accepted-model",
            modelSha256: acceptedDownload?.sha256
          }
        : {
            type: "offline-official-output",
            modelId: reference.model.id,
            modelVersion: reference.model.version,
            modelRevision: reference.model.revision,
            modelBytes: reference.model.bytes,
            modelSha256: reference.model.sha256,
            generatedAt: reference.generatedAt
          },
    referenceModelSha256: acceptedDownload?.sha256 ?? reference?.model.sha256,
    ...(acceptedDownload === undefined ? {} : { acceptedModelSha256: acceptedDownload.sha256 }),
    executionProvider: backend,
    precision,
    requestedSource,
    sourceKind: result.model.source.kind,
    manifestRevision:
      candidateDownload?.revision ??
      manifestVariant!.sources?.find((source) => source.kind === result.model.source.kind)
        ?.revision,
    fallbacks: result.runtime.fallbacks,
    modelBytes: result.model.bytes,
    modelSha256: result.model.source.sha256,
    onnxruntimeWebVersion: "1.27.0",
    adapter: result.adapter,
    adapterFeatures: result.adapterFeatures,
    browser: { name: "Chromium", version: browser.version(), userAgent: result.browser },
    operatingSystem: `${platform()} ${release()}`,
    fixtures: fixtureEvidence,
    timingsMs: result.timings,
    sdkCommit,
    capabilities: result.runtime.capabilities,
    cpu: cpus()[0]?.model ?? "unknown",
    generatedAt: new Date().toISOString(),
    id: mode
  };
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  expect(validationErrors).toEqual([]);
  for (const fixture of evaluatedFixtures) {
    expect(fixture.parity).toBe("passed");
    expect(fixture.acceptedOutputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.outputSha256).toMatch(/^[a-f0-9]{64}$/);
  }
});

declare global {
  interface Window {
    PPDetection?: typeof import("../../packages/sdk/src/index");
  }
}
