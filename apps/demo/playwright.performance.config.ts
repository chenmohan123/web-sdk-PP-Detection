import { defineConfig } from "playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: "http://127.0.0.1:4298" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4298",
    port: 4298,
    reuseExistingServer: false
  }
});
