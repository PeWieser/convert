import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.ts",
  outputDir: ".tmp/playwright",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1100, height: 800 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {},
  },
  webServer: { command: "npm run dev -- --port 5173", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI },
});
