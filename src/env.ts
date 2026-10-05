import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().startsWith("postgres"),
  DATABASE_OWNER_URL: z.string().startsWith("postgres").optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1),
  /**
   * AES-256-GCM key (base64, 32 bytes) for the secrets stored per organization (gateway
   * passwords, API tokens). Optional: derived from BETTER_AUTH_SECRET when absent.
   */
  SECRETS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64")
    .optional(),
  /**
   * Local stand-ins of the SATIM gateway and the WhatsApp Cloud API (`/api/dev/*`), so online
   * payments and messages work without credentials. Default: on outside production builds.
   */
  DEV_GATEWAYS: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  /** SATIM REST base URLs; the test one defaults to the stand-in when DEV_GATEWAYS is on. */
  SATIM_TEST_URL: z.url().optional(),
  SATIM_PRODUCTION_URL: z.url().default("https://cib.satim.dz/payment/rest"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

/** Validated server environment, parsed at import: throws if anything is missing or invalid. */
export const env: ServerEnv = parseEnv();
