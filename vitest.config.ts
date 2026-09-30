import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { testEnv } from "./tests/test-env.ts";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path("./src"),
      "server-only": path("./tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    env: testEnv,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
