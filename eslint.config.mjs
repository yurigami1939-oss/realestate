import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// CLAUDE.md §5 Data access: only the data layer may touch the database.
const dataLayerOnly = {
  paths: [{ name: "drizzle-orm", message: "Use src/server/<module> queries/services." }],
  patterns: [
    {
      group: ["@/db", "@/db/*", "drizzle-orm/*", "pg", "pg-boss"],
      message: "Database access is restricted to src/db, src/server, src/jobs, scripts, tests.",
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": ["error", dataLayerOnly],
    },
  },
  {
    files: [
      "src/db/**",
      "src/server/**",
      "src/jobs/**",
      "scripts/**",
      "tests/**",
      "e2e/**",
      "*.config.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["**/*.test.ts", "tests/**", "e2e/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/db/migrations/**",
    "playwright-report/**",
    "test-results/**",
    "tmp/**",
  ]),
]);
