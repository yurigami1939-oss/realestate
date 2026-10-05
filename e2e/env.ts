/** Environment of the e2e web server and database reset. CI overrides the URLs through env vars. */
export const E2E_PORT = 3100;

const pg = (user: string, password: string) =>
  `postgres://${user}:${password}@localhost:5433/realestate_e2e`;

export const e2eEnv: Record<string, string> = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? pg("realestate_app", "app"),
  DATABASE_OWNER_URL: process.env.E2E_DATABASE_OWNER_URL ?? pg("realestate_owner", "owner"),
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-000",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET ?? "realestate",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "devaccesskey",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "devsecretkey",
  SMTP_HOST: process.env.SMTP_HOST ?? "localhost",
  SMTP_PORT: process.env.SMTP_PORT ?? "1025",
  SMTP_FROM: "PRODUCT_NAME <no-reply@example.test>",
  // Production build: the SATIM and WhatsApp stand-ins must be asked for.
  DEV_GATEWAYS: "true",
};
