import { appendFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

// 发布与等待分离：此脚本只读取 registry，绝不重试 npm publish。
export async function waitForNpmPublication({
  packageName,
  version,
  timeoutMs = 600000,
  intervalMs = 6000,
  fetchImpl = fetch,
  now = Date.now,
  sleep = delay
}) {
  if (
    !packageName ||
    !version ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new TypeError("包名、版本和等待参数无效");
  }
  const start = now();
  const attempts = [];
  const result = (status, extra) => ({
    status,
    packageName,
    version,
    attempts: attempts.length,
    elapsedMs: now() - start,
    history: attempts,
    ...extra
  });
  while (now() - start < timeoutMs) {
    let response;
    let metadata;
    try {
      response = await fetchImpl(
        `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
        {
          signal: AbortSignal.timeout(Math.max(1, Math.min(10000, timeoutMs - (now() - start)))),
          headers: { accept: "application/json" }
        }
      );
      if (response.ok) metadata = await response.json();
    } catch (error) {
      attempts.push({
        elapsedMs: now() - start,
        ...(response ? { httpStatus: response.status } : {}),
        error: String(error)
      });
      if (error instanceof SyntaxError) {
        return result("failed", { error: "registry 返回无效 JSON 元数据" });
      }
      // HTTP 200 的响应体也可能断流或超时，沿用总时限内的网络重试。
      response = undefined;
    }
    if (response) {
      attempts.push({ elapsedMs: now() - start, httpStatus: response.status });
      if (response.ok) {
        if (
          !metadata ||
          typeof metadata !== "object" ||
          metadata.name !== packageName ||
          metadata.version !== version ||
          !/^sha512-[A-Za-z0-9+/]{86}==$/.test(metadata.dist?.integrity ?? "")
        ) {
          return result("failed", { error: "registry 元数据中的包名、版本或 SHA-512 完整性无效" });
        }
        return result("passed", {
          integrity: metadata.dist.integrity,
          attestations: metadata.dist.attestations ?? null
        });
      }
      await response.body?.cancel();
      if (response.status !== 404 && response.status !== 429 && response.status < 500) {
        return result("failed", { error: `registry 返回不可重试的 HTTP ${response.status}` });
      }
    }
    const remaining = timeoutMs - (now() - start);
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
  }
  return result("failed", { error: "等待 npm registry 发布元数据超时" });
}

async function main() {
  const [packageName, version, output] = process.argv.slice(2);
  const report = await waitForNpmPublication({ packageName, version });
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## npm 发布完整性\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`
    );
  console.log(JSON.stringify(report));
  process.exitCode = report.status === "passed" ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
