import { defineConfig } from "playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: process.env.PPDETECTION_PLAYWRIGHT_OUTPUT_DIR ?? "./test-results",
  reporter: "list",
  testDir: "./tests/browser",
  timeout: 180_000,
  use: {
    browserName: "chromium",
    channel: process.env.PPDETECTION_REAL_MODEL === "1" ? "chromium" : undefined,
    headless: true
  },
  workers: 1
});
