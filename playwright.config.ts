import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "en",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /rtl\.spec\.ts/u,
    },
    {
      name: "zh-CN",
      use: { ...devices["Desktop Chrome"], locale: "zh-CN" },
      testIgnore: /rtl\.spec\.ts/u,
    },
    {
      name: "rtl-desktop",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /rtl\.spec\.ts/u,
    },
    {
      name: "rtl-mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /rtl\.spec\.ts/u,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          "pnpm --filter @unimailbox/web exec vite --host 127.0.0.1 --port 5173",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
