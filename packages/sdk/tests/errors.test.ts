import { expect, it } from "vitest";
import { PPDetectionError } from "../src/errors";

it("错误 code 和 details 可序列化", () => {
  const error = new PPDetectionError("INFERENCE_FAILED", "推理失败", {
    backend: "wasm",
    attempt: 1
  });
  expect(JSON.parse(JSON.stringify({ code: error.code, details: error.details }))).toEqual({
    code: "INFERENCE_FAILED",
    details: { backend: "wasm", attempt: 1 }
  });
});
