import { migrateDatabase } from "@/db/migrate";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_URL are required");

await migrateDatabase({ ownerUrl, appUrl });
console.log("Database migrated.");
