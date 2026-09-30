import { execSync } from "node:child_process";

import { e2eEnv } from "./env";

/**
 * Resets realestate_e2e (drop, migrate, seed the demo promoter) and creates the S3 bucket,
 * in child processes: server modules need the `server-only` shim that tsx loads.
 */
export default function globalSetup() {
  const run = (script: string) =>
    execSync(`pnpm exec tsx --import ./scripts/shims/server-only.mjs ${script}`, {
      stdio: "inherit",
      env: { ...process.env, ...e2eEnv },
    });
  run("scripts/storage-init.ts");
  run("scripts/db-reset.ts");
}
