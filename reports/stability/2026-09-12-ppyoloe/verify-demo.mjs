// 复用真实浏览器验收流程，固定稳定版本预期并将新结果写入本阶段目录。
process.env.PPDETECTION_EXPECTED_VERSION = "0.1.0";
process.env.PPDETECTION_EXPECT_STABLE = "1";
process.env.PPDETECTION_DEMO_SOURCE ??= "modelscope";
process.env.PPDETECTION_REPORT_DIRECTORY ??= "reports/stability/2026-09-12-ppyoloe/browser";
await import("../../distribution/2026-09-11-ppyoloe/verify-demo.mjs");
