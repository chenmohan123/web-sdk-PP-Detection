import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForNpmPublication } from "./wait-npm-publication.mjs";
const metadata = {
  name: "web-sdk-pp-detection",
  version: "0.3.0",
  dist: { integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64") }
};
function clock() {
  let value = 0;
  return {
    now: () => value,
    sleep: async (ms) => {
      value += ms;
    }
  };
}
test("registry 超过两分钟后可用仍能取得完整性", async () => {
  const time = clock();
  let calls = 0;
  const result = await waitForNpmPublication({
    packageName: metadata.name,
    version: metadata.version,
    ...time,
    fetchImpl: async () => {
      calls++;
      return time.now() < 180000 ? new Response(null, { status: 404 }) : Response.json(metadata);
    }
  });
  assert.equal(result.status, "passed");
  assert.equal(result.elapsedMs, 180000);
  assert.equal(result.integrity, metadata.dist.integrity);
  assert(calls > 20);
});
test("网络错误、限流和服务端暂时错误允许重试", async () => {
  const statuses = [null, 429, 503, 200];
  const result = await waitForNpmPublication({
    packageName: metadata.name,
    version: metadata.version,
    ...clock(),
    fetchImpl: async () => {
      const status = statuses.shift();
      if (status === null) throw new TypeError("暂时断网");
      return status === 200 ? Response.json(metadata) : new Response(null, { status });
    }
  });
  assert.equal(result.status, "passed");
  assert.equal(result.attempts, 4);
});
test("401 永久错误立即停止", async () => {
  const result = await waitForNpmPublication({
    packageName: metadata.name,
    version: metadata.version,
    ...clock(),
    fetchImpl: async () => new Response(null, { status: 401 })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts, 1);
  assert.match(result.error, /401/u);
});
test("错误版本或缺失完整性不得记为成功", async () => {
  for (const value of [null, { ...metadata, version: "0.2.0" }, { ...metadata, dist: {} }]) {
    const result = await waitForNpmPublication({
      packageName: metadata.name,
      version: metadata.version,
      ...clock(),
      timeoutMs: 12000,
      fetchImpl: async () => Response.json(value)
    });
    assert.equal(result.status, "failed");
    assert.equal(result.attempts, 1);
    assert.match(result.error, /元数据/u);
  }
});
test("持续不可用十分钟后失败并保留尝试记录", async () => {
  const result = await waitForNpmPublication({
    packageName: metadata.name,
    version: metadata.version,
    ...clock(),
    fetchImpl: async () => new Response(null, { status: 404 })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.elapsedMs, 600000);
  assert.equal(result.attempts, 100);
  assert.match(result.error, /超时/u);
});
