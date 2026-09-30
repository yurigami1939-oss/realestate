import { execSync, spawn } from "node:child_process";

import { e2eEnv } from "./env";

const env = { ...process.env, ...e2eEnv };
const tsx = "pnpm exec tsx --import ./scripts/shims/server-only.mjs";

/** Starts the job worker (PDF rendering) and resolves once it listens; returns its stopper. */
function startWorker(): Promise<() => void> {
  const worker = spawn(`${tsx} src/jobs/worker.ts`, {
    env,
    shell: true,
    stdio: ["ignore", "pipe", "inherit"],
    // Own process group on POSIX, so the whole tree can be stopped.
    detached: process.platform !== "win32",
  });
  const stop = () => {
    if (worker.pid === undefined || worker.exitCode !== null) return;
    if (process.platform === "win32")
      execSync(`taskkill /pid ${worker.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-worker.pid, "SIGTERM");
  };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stop();
      reject(new Error("e2e: the worker did not start within 60 s"));
    }, 60_000);
    worker.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes("[worker] started")) {
        clearTimeout(timeout);
        resolve(stop);
      }
    });
    worker.on("exit", (code) => reject(new Error(`e2e: the worker exited (${code})`)));
  });
}

/**
 * Creates the S3 bucket, resets realestate_e2e (drop, migrate, seed) and starts the job worker,
 * in child processes: server modules need the `server-only` shim that tsx loads. The worker
 * starts after the reset (it would lose its queues otherwise) and stops after the run.
 */
export default async function globalSetup() {
  const run = (script: string) => execSync(`${tsx} ${script}`, { stdio: "inherit", env });
  run("scripts/storage-init.ts");
  run("scripts/db-reset.ts");
  return startWorker();
}
