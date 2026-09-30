import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT, e2eEnv } from "./e2e/env";

const baseURL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    locale: "fr-DZ",
    timezoneId: "Africa/Algiers",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${E2E_PORT}`,
    // A static file: the readiness check must not depend on the database being migrated yet.
    url: `${baseURL}/favicon.ico`,
    env: e2eEnv,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
