/**
 * `pnpm console:backfill` (local databases only): gives every organization without a client
 * account one (CLAUDE.console.md §3) — a database seeded before the console, or organizations
 * created before it. A gérant's companies share one account, active on Promoteur (Groupe beyond
 * its two companies) with every add-on; the catalog is created first when missing.
 */
import { and, eq, notInArray } from "drizzle-orm";

import { pool } from "@/db/client";
import { consoleDb, consolePool } from "@/db/console-client";
import { accountOrganization, member, organization, plan } from "@/db/schema";
import { seedConsoleCatalog } from "@/db/seed/console";
import { assertLocalDatabase } from "@/db/seed/guard";
import { stopEnqueue } from "@/jobs/enqueue";
import { addonCodes } from "@/lib/subscriptions";
import { openBillingAccount } from "@/server/console/accounts";
import { systemOperator } from "@/server/console/context";
import { openAccountSchema } from "@/server/console/schemas";

const appUrl = process.env.DATABASE_URL;
if (!appUrl) throw new Error("DATABASE_URL is required");
assertLocalDatabase(appUrl);

const [catalog] = await consoleDb
  .select({ id: plan.id })
  .from(plan)
  .where(eq(plan.code, "promoteur"));
if (!catalog) await seedConsoleCatalog();

const held = consoleDb.select({ id: accountOrganization.organizationId }).from(accountOrganization);
const orphans = await consoleDb
  .select({ id: organization.id, owner: member.userId })
  .from(organization)
  .leftJoin(member, and(eq(member.organizationId, organization.id), eq(member.role, "owner")))
  .where(notInArray(organization.id, held))
  .orderBy(organization.createdAt);

const byOwner = new Map<string, string[]>();
for (const { id, owner } of orphans) {
  const key = owner ?? id;
  byOwner.set(key, [...new Set([...(byOwner.get(key) ?? []), id])]);
}
for (const organizationIds of byOwner.values()) {
  await openBillingAccount(
    systemOperator,
    openAccountSchema.parse({
      legalName: "",
      organizationIds,
      planCode: organizationIds.length > 2 ? "groupe" : "promoteur",
      status: "active",
      program: "standard",
      billingPeriod: "yearly",
      addons: addonCodes.map((code) => ({ code })),
    }),
  );
}
console.log(`Console backfill: ${byOwner.size} accounts for ${orphans.length} organizations.`);

await stopEnqueue();
await pool.end();
await consolePool.end();
