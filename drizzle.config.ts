import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the process environment (CI)
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  // public (tenants) and console (the operator's layer, CLAUDE.console.md §3); pgboss is pg-boss's.
  schemaFilter: ["public", "console"],
  out: "./src/db/migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? "",
  },
});
