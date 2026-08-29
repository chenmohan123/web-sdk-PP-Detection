import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ORDER = ["huggingface", "modelscope", "git-lfs"];
const MAX_REDIRECTS = 5;
const ALLOWED_HOSTS = new Set([
  "huggingface.co",
  "www.modelscope.cn",
  "media.githubusercontent.com"
]);
const SOURCE_KINDS = new Set([...SOURCE_ORDER, "custom"]);

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw safeError("模型来源 URL 格式无效", "INVALID_MANIFEST");
  }
}

function sanitizeMessage(message) {
  return String(message)
    .replace(/https?:\/\/[^\s]+/gi, (value) => {
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[已隐藏 URL]";
      }
    })
    .replace(/\b(?:authorization|bearer|token|secret)(?:[=:]|\s+)[^\s]*/gi, "[已隐藏]")
    .replace(/\b(?:token|secret)\b/gi, "[已隐藏]");
}

function safeError(message, code) {
  const error = new Error(sanitizeMessage(message));
  if (code !== undefined) error.code = code;
  return error;
}

function normalizedHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname) {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost") return true;
  const version = isIP(normalized);
  if (version === 4) return normalized.startsWith("127.");
  return version === 6 && (normalized === "::1" || normalized.startsWith("::ffff:127."));
}

function isPrivateHostname(hostname) {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost") return true;
  const version = isIP(normalized);
  if (version === 4) {
    const [first, second] = normalized.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return (
    version === 6 &&
    (normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127."))
  );
}

function isLocalHttpUrl(value) {
  const url = parseUrl(value);
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function isAllowedSourceHost(kind, hostname) {
  if (kind === "huggingface") {
    return (
      hostname === "huggingface.co" ||
      hostname.endsWith(".huggingface.co") ||
      hostname === "hf.co" ||
      hostname.endsWith(".hf.co")
    );
  }
  if (kind === "modelscope") {
    return hostname === "modelscope.cn" || hostname.endsWith(".modelscope.cn");
  }
  if (kind === "git-lfs") return hostname === "media.githubusercontent.com";
  return false;
}

function isAllowedUrl(value, { local = false, custom = false, kind } = {}) {
  const url = parseUrl(value);
  if (isPrivateHostname(url.hostname)) return local && isLocalHttpUrl(value);
  if (url.protocol === "https:") {
    const publicHost =
      ALLOWED_HOSTS.has(url.hostname) ||
      url.hostname.endsWith(".huggingface.co") ||
      url.hostname.endsWith(".hf.co") ||
      url.hostname === "modelscope.cn" ||
      url.hostname.endsWith(".modelscope.cn");
    if (custom) return true;
    if (kind !== undefined) return isAllowedSourceHost(kind, url.hostname);
    return publicHost || local;
  }
  return local && isLocalHttpUrl(value);
}

function hasCredentials(value) {
  const url = parseUrl(value);
  return url.username !== "" || url.password !== "";
}

async function fetchPublic(
  url,
  fetchImpl,
  { custom = false, allowLocal = false, kind, redirects = 0 } = {}
) {
  const parsed = parseUrl(url);
  const local = allowLocal && isLocalHttpUrl(url);
  if (!isAllowedUrl(url, { local, custom, kind }))
    throw safeError("模型来源 URL 主机或协议不在允许范围", "MODEL_SOURCE_UNAVAILABLE");
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual" });
  } catch (error) {
    throw safeError(
      `模型来源请求失败：${error instanceof Error ? error.message : error}`,
      "MODEL_SOURCE_UNAVAILABLE"
    );
  }
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS)
      throw safeError("模型来源重定向次数过多", "MODEL_SOURCE_UNAVAILABLE");
    const location = response.headers.get("location");
    if (!location) throw safeError("模型来源重定向缺少目标", "MODEL_SOURCE_UNAVAILABLE");
    const redirectedUrl = parseUrl(new URL(location, url).toString());
    if (
      hasCredentials(redirectedUrl.toString()) ||
      redirectedUrl.protocol !== "https:" ||
      !isAllowedUrl(redirectedUrl.toString(), { custom, kind })
    )
      throw safeError("模型来源重定向不是允许的 HTTPS 地址", "MODEL_SOURCE_UNAVAILABLE");
    return fetchPublic(redirectedUrl.toString(), fetchImpl, {
      custom,
      kind,
      redirects: redirects + 1
    });
  }
  if (!response.ok) throw safeError(`模型来源 HTTP ${response.status}`, "MODEL_SOURCE_UNAVAILABLE");
  return response;
}

async function readVerifiedModel(response, source, target) {
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw safeError(
      `模型来源响应读取失败：${error instanceof Error ? error.message : error}`,
      "MODEL_DOWNLOAD_FAILED"
    );
  }
  const contentLength = response.headers?.get("content-length") ?? null;
  if (contentLength === null)
    throw safeError(`来源响应缺少 Content-Length（${source.kind}）`, "MODEL_INTEGRITY_FAILED");
  if (contentLength !== null && Number(contentLength) !== bytes.byteLength)
    throw safeError(
      `来源 Content-Length 与实际大小不一致（${source.kind}）`,
      "MODEL_INTEGRITY_FAILED"
    );
  if (bytes.byteLength !== source.bytes)
    throw safeError(`来源 bytes 校验失败（${source.kind}）`, "MODEL_INTEGRITY_FAILED");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== source.sha256.toLowerCase())
    throw safeError(`来源 SHA-256 校验失败（${source.kind}）`, "MODEL_INTEGRITY_FAILED");
  await writeFile(target, bytes);
  return { bytes: bytes.byteLength, sha256 };
}

function validateSource(source, { allowLocal = false, variant } = {}) {
  if (!source || !SOURCE_KINDS.has(source.kind))
    throw safeError("模型清单来源类型无效", "INVALID_MANIFEST");
  if (!/^[a-f0-9]{40,64}$/i.test(source.revision ?? ""))
    throw safeError(`模型清单来源 revision 无效（${source.kind}）`, "INVALID_MANIFEST");
  if (!Number.isSafeInteger(source.bytes) || source.bytes <= 0)
    throw safeError(`模型清单来源 bytes 无效（${source.kind}）`, "INVALID_MANIFEST");
  if (!/^[a-f0-9]{64}$/i.test(source.sha256 ?? ""))
    throw safeError(`模型清单来源 SHA-256 无效（${source.kind}）`, "INVALID_MANIFEST");
  if (variant !== undefined) {
    if (source.bytes !== variant.bytes)
      throw safeError(`来源 bytes 与变体不一致（${source.kind}）`, "INVALID_MANIFEST");
    if (source.sha256.toLowerCase() !== variant.sha256.toLowerCase())
      throw safeError(`来源 source.sha256 与变体不一致（${source.kind}）`, "INVALID_MANIFEST");
  }
  if (typeof source.downloadUrl !== "string")
    throw safeError(`模型清单来源缺少下载 URL（${source.kind}）`, "INVALID_MANIFEST");
  if (hasCredentials(source.downloadUrl))
    throw safeError(`模型清单来源 URL 不得包含凭据（${source.kind}）`, "INVALID_MANIFEST");
  if (
    !isAllowedUrl(source.downloadUrl, {
      custom: source.kind === "custom",
      kind: source.kind === "custom" ? undefined : source.kind,
      local: allowLocal
    })
  )
    throw safeError(`模型清单来源 URL 不允许（${source.kind}）`, "INVALID_MANIFEST");
  return source;
}

function sanitizeManifest(manifest) {
  const copy = structuredClone(manifest);
  for (const variant of copy.variants ?? []) {
    for (const source of variant.sources ?? []) {
      const url = parseUrl(source.downloadUrl);
      url.search = "";
      url.hash = "";
      source.downloadUrl = url.toString();
    }
  }
  return copy;
}

export async function fetchModelSource({
  manifestUrl,
  source = "auto",
  variantId,
  fetchImpl = fetch
} = {}) {
  if (
    typeof manifestUrl !== "string" ||
    !isAllowedUrl(manifestUrl, {
      local: typeof manifestUrl === "string" && isLocalHttpUrl(manifestUrl)
    })
  )
    throw safeError("manifest URL 必须是允许的 HTTPS 地址", "MODEL_SOURCE_UNAVAILABLE");
  if (hasCredentials(manifestUrl))
    throw safeError("manifest URL 不得包含凭据", "MODEL_SOURCE_UNAVAILABLE");
  const manifestResponse = await fetchPublic(manifestUrl, fetchImpl, {
    allowLocal: isLocalHttpUrl(manifestUrl)
  });
  let manifest;
  try {
    manifest = await manifestResponse.json();
  } catch (error) {
    throw safeError(
      `模型清单 JSON 无效：${error instanceof Error ? error.message : error}`,
      "INVALID_MANIFEST"
    );
  }
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.status === "labs/blocked" ||
    !Array.isArray(manifest.variants) ||
    manifest.variants.length === 0
  )
    throw safeError("模型清单处于 blocked 或没有可用变体", "MODEL_SOURCE_UNAVAILABLE");
  const variant =
    variantId === undefined
      ? manifest.variants[0]
      : manifest.variants.find((candidate) => candidate?.id === variantId);
  if (!variant) throw safeError(`模型清单缺少变体：${variantId}`, "INVALID_MANIFEST");
  if (typeof variant.filename !== "string" || basename(variant.filename) !== variant.filename)
    throw safeError("模型清单文件名无效", "INVALID_MANIFEST");
  if (!Number.isSafeInteger(variant.bytes) || variant.bytes <= 0)
    throw safeError("模型清单变体 bytes 无效", "INVALID_MANIFEST");
  if (!/^[a-f0-9]{64}$/i.test(variant.sha256 ?? ""))
    throw safeError("模型清单变体 SHA-256 无效", "INVALID_MANIFEST");
  const candidates = Array.isArray(variant.sources) ? variant.sources : [];
  const allowLocalSources = isLocalHttpUrl(manifestUrl);
  candidates.forEach((candidate) =>
    validateSource(candidate, { allowLocal: allowLocalSources, variant })
  );
  const ordered = source === "auto" ? SOURCE_ORDER : [source];
  const selected = ordered
    .map((kind) => candidates.find((item) => item.kind === kind))
    .filter(Boolean);
  if (selected.length === 0) throw safeError("模型清单缺少请求的来源", "MODEL_SOURCE_UNAVAILABLE");
  const directory = await mkdtemp(join(tmpdir(), "pp-detection-model-"));
  const manifestPath = join(directory, "manifest.json");
  const modelPath = join(directory, variant.filename);
  await writeFile(manifestPath, `${JSON.stringify(sanitizeManifest(manifest), null, 2)}\n`, "utf8");
  let lastError;
  for (const candidate of selected) {
    try {
      const response = await fetchPublic(candidate.downloadUrl, fetchImpl, {
        custom: candidate.kind === "custom",
        kind: candidate.kind === "custom" ? undefined : candidate.kind,
        allowLocal: allowLocalSources
      });
      const verified = await readVerifiedModel(response, candidate, modelPath);
      return {
        manifestPath,
        modelPath,
        variantId: variant.id,
        sourceKind: candidate.kind,
        revision: candidate.revision,
        sha256: verified.sha256,
        bytes: verified.bytes,
        cleanup: () => rm(directory, { recursive: true, force: true })
      };
    } catch (error) {
      lastError = error;
      if (source !== "auto") break;
    }
  }
  await rm(directory, { recursive: true, force: true });
  throw lastError ?? safeError("模型来源不可用", "MODEL_SOURCE_UNAVAILABLE");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestUrl = process.env.PPDETECTION_MODEL_MANIFEST_URL?.trim();
  if (!manifestUrl) throw new Error("请设置 PPDETECTION_MODEL_MANIFEST_URL");
  const requestedSource = process.env.PPDETECTION_MODEL_SOURCE?.trim() || "auto";
  const requestedVariant = process.env.PPDETECTION_MODEL_VARIANT?.trim() || undefined;
  const downloads = [
    await fetchModelSource({ manifestUrl, source: requestedSource, variantId: requestedVariant })
  ];
  try {
    const outputDirectory = process.env.PPDETECTION_MODEL_OUTPUT_DIR?.trim();
    if (outputDirectory) {
      const downloadedManifest = JSON.parse(await readFile(downloads[0].manifestPath, "utf8"));
      for (const variant of downloadedManifest.variants ?? []) {
        if (variant.id === downloads[0].variantId) continue;
        downloads.push(
          await fetchModelSource({ manifestUrl, source: requestedSource, variantId: variant.id })
        );
      }
      await mkdir(outputDirectory, { recursive: true });
      for (const download of downloads) {
        await copyFile(download.modelPath, join(outputDirectory, basename(download.modelPath)));
      }
      await copyFile(downloads[0].manifestPath, join(outputDirectory, "manifest.json"));
    }
    console.log(
      JSON.stringify({
        bytes: downloads[0].bytes,
        revision: downloads[0].revision,
        sha256: downloads[0].sha256,
        sourceKind: downloads[0].sourceKind
      })
    );
  } finally {
    await Promise.all(downloads.map((download) => download.cleanup()));
  }
}
