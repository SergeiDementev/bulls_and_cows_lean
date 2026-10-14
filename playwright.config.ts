import { defineConfig, devices } from "@playwright/test";

/** The production build of the Mini App against a real server, in Chromium and WebKit (Safari). */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [
    // iPhone SE size: the phone the author checks VoiceOver on
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 667 } },
    },
    { name: "webkit", use: { ...devices["iPhone SE"] } },
  ],
  webServer: [
    {
      command: "node scripts/e2e-server.ts",
      url: "http://localhost:3100/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm build && pnpm exec vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      // The preview proxies /api/ to the e2e server
      env: { PORT: "3100" },
      reuseExistingServer: false,
    },
  ],
});
