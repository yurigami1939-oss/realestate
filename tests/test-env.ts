/** Environment for Vitest workers and global setup. CI overrides the URLs through env vars. */
const pg = (user: string, password: string) =>
  `postgres://${user}:${password}@localhost:5433/realestate_test`;

export const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? pg("realestate_app", "app"),
  DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL ?? pg("realestate_owner", "owner"),
  BETTER_AUTH_SECRET: "test-only-secret-test-only-secret-000",
  BETTER_AUTH_URL: "http://localhost:3000",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET ?? "realestate",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "devaccesskey",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "devsecretkey",
  SMTP_HOST: process.env.SMTP_HOST ?? "localhost",
  SMTP_PORT: process.env.SMTP_PORT ?? "1025",
  SMTP_FROM: "PRODUCT_NAME <no-reply@example.test>",
  TZ: "UTC",
} as const;
