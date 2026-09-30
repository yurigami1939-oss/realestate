import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Role } from "@/lib/permissions";
import { auth } from "@/server/auth/auth";
import type { TenantCtx } from "@/server/auth/session";

import { DEMO_PASSWORD, demoOrganizations, demoUsers } from "./demo";
import { seedCrm } from "./crm";
import { seedInventory } from "./inventory";
import { seedPaymentPlans, seedQuotations } from "./sales";

/** Refuses anything but a local database: seeding wipes data. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`Refusing to seed/reset a non-local database (${host}).`);
  }
}

/** Empties every table of the public schema (owner connection; migrations table lives elsewhere). */
export async function wipeData(ownerUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const db = drizzle({ client: pool });
    const { rows } = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (rows.length > 0) {
      const tables = rows.map((r) => `public."${r.tablename}"`).join(", ");
      await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
    }
  } finally {
    await pool.end();
  }
}

/**
 * Creates the demo promoter through Better Auth so passwords and memberships are real,
 * then its business data through the services (histories and audit included).
 */
export async function seedDemo(): Promise<void> {
  const userIds = new Map<string, string>();
  for (const user of demoUsers) {
    const { user: created } = await auth.api.signUpEmail({
      body: { name: user.name, email: user.email, password: DEMO_PASSWORD },
    });
    userIds.set(user.key, created.id);
  }

  const owner = demoUsers[0];
  const ownerId = userIds.get(owner.key);
  if (!ownerId) throw new Error("seed: owner missing");

  for (const { members, ...org } of demoOrganizations) {
    const created = await auth.api.createOrganization({ body: { ...org, userId: ownerId } });
    if (!created) throw new Error(`seed: organization ${org.slug} not created`);
    if (members !== "all") continue;
    for (const user of demoUsers.slice(1)) {
      await auth.api.addMember({
        body: {
          userId: userIds.get(user.key) ?? "",
          role: [...user.roles],
          organizationId: created.id,
        },
      });
    }

    const ctx = (key: (typeof demoUsers)[number]["key"], roles: Role[]): TenantCtx => ({
      userId: userIds.get(key) ?? "",
      orgId: created.id,
      roles,
      locale: "fr",
    });
    const salesManager = ctx("salesManager", ["sales_manager"]);
    const agentA = ctx("salesAgent", ["sales_agent"]);
    const agentB = ctx("salesAgent2", ["sales_agent"]);
    const { projectIds, unitIds } = await seedInventory({
      owner: ctx("owner", ["owner"]),
      salesManager,
    });
    const plans = await seedPaymentPlans(salesManager, projectIds);
    const leads = await seedCrm({ manager: salesManager, agentA, agentB }, projectIds);
    await seedQuotations(
      { manager: salesManager, agentA, agentB },
      { leads, units: unitIds, plans },
    );
  }
}
