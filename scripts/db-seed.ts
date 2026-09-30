/** `pnpm db:seed`: wipes local data and seeds the demo promoter. */
import { pool } from "@/db/client";
import { assertLocalDatabase, seedDemo, wipeData } from "@/db/seed";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_URL are required");
assertLocalDatabase(appUrl);

await wipeData(ownerUrl);
await seedDemo();
await pool.end();
console.log("Seeded the demo promoter (see src/db/seed/demo.ts for accounts).");
