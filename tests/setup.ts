import { afterAll } from "vitest";

import { pool } from "@/db/client";

afterAll(async () => {
  await pool.end();
});
