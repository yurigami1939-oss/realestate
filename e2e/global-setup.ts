import { execSync } from "node:child_process";

import { e2eEnv } from "./env";

/**
 * Resets realestate_e2e (drop, migrate, seed the demo promoter) in a child process:
 * server modules need the `server-only` shim that tsx loads.
 */
export default function globalSetup() {
  execSync("pnpm exec tsx --import ./scripts/shims/server-only.mjs scripts/db-reset.ts", {
    stdio: "inherit",
    env: { ...process.env, ...e2eEnv },
  });
}
