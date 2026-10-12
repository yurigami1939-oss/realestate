import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/env";

import * as schema from "./schema";

const globalForConsole = globalThis as unknown as { consolePool?: Pool };

/**
 * Pool for the operator console's role (`realestate_console`, CLAUDE.console.md §3): DML on
 * schema `console`, a few grants on `public`, never RLS bypass — tenant rows are written through
 * `withConsoleTenant`. Imported only by src/server/console, src/jobs, scripts, tests (ESLint).
 */
export const consolePool =
  globalForConsole.consolePool ?? new Pool({ connectionString: env.CONSOLE_DATABASE_URL, max: 5 });
if (env.NODE_ENV !== "production") globalForConsole.consolePool = consolePool;

export const consoleDb = drizzle({ client: consolePool, schema, casing: "snake_case" });

export type ConsoleDb = typeof consoleDb;
export type ConsoleTx = Parameters<Parameters<ConsoleDb["transaction"]>[0]>[0];
