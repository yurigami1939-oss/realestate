import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, documentSequence } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import { createOrganization } from "./factories";

/** Tables that carry organization_id but are scoped by Better Auth itself. */
const RLS_EXEMPT = ["member", "invitation"];

describe("row-level security catalog", () => {
  it("forces RLS with a tenant_isolation policy on every table that has organization_id", async () => {
    const { rows } = await db.execute<{
      table_name: string;
      rls: boolean;
      forced: boolean;
      has_policy: boolean;
    }>(sql`
      select c.relname as table_name,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = c.relname
                       and p.policyname = 'tenant_isolation') as has_policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname
                      and col.column_name = 'organization_id')
    `);

    const tenantTables = rows.filter((r) => !RLS_EXEMPT.includes(r.table_name));
    expect(tenantTables.length).toBeGreaterThanOrEqual(2);
    const unprotected = tenantTables.filter((r) => !r.rls || !r.forced || !r.has_policy);
    expect(unprotected.map((r) => r.table_name)).toEqual([]);
  });

  it("connects the app as a role that cannot bypass RLS", async () => {
    const { rows } = await db.execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owns: boolean;
    }>(sql`
      select r.rolsuper, r.rolbypassrls,
             exists (select 1 from pg_tables t where t.tableowner = current_user and t.schemaname = 'public') as owns
      from pg_roles r where r.rolname = current_user
    `);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: false });
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's rows and refuses writes into it", async () => {
    const orgA = await createOrganization();
    const orgB = await createOrganization();

    await withTenant({ orgId: orgA.id }, (tx) =>
      tx
        .insert(documentSequence)
        .values({ organizationId: orgA.id, docType: "receipt", year: 2026 }),
    );

    const seenByB = await withTenant({ orgId: orgB.id }, (tx) =>
      tx.select().from(documentSequence).where(eq(documentSequence.organizationId, orgA.id)),
    );
    expect(seenByB).toEqual([]);

    const updatedByB = await withTenant({ orgId: orgB.id }, (tx) =>
      tx
        .update(documentSequence)
        .set({ lastValue: 99 })
        .where(eq(documentSequence.organizationId, orgA.id))
        .returning(),
    );
    expect(updatedByB).toEqual([]);

    await expect(
      withTenant({ orgId: orgB.id }, (tx) =>
        tx
          .insert(documentSequence)
          .values({ organizationId: orgA.id, docType: "quotation", year: 2026 }),
      ),
    ).rejects.toThrow();

    const seenByA = await withTenant({ orgId: orgA.id }, (tx) =>
      tx.select().from(documentSequence).where(eq(documentSequence.organizationId, orgA.id)),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]?.lastValue).toBe(0);
  });

  it("returns nothing outside a tenant transaction", async () => {
    const org = await createOrganization();
    await withTenant({ orgId: org.id }, (tx) =>
      tx
        .insert(documentSequence)
        .values({ organizationId: org.id, docType: "receipt", year: 2026 }),
    );
    const rows = await db
      .select()
      .from(documentSequence)
      .where(eq(documentSequence.organizationId, org.id));
    expect(rows).toEqual([]);
  });

  it("rejects a malformed organization id before touching the database", async () => {
    await expect(withTenant({ orgId: "' or 1=1 --" }, async () => 1)).rejects.toThrow(
      /invalid organization id/,
    );
  });
});

describe("append-only audit log", () => {
  it("lets the app insert but never update or delete", async () => {
    const org = await createOrganization();
    const [row] = await withTenant({ orgId: org.id }, (tx) =>
      tx
        .insert(auditLog)
        .values({
          organizationId: org.id,
          action: "test.create",
          entityType: "test",
          entityId: org.id,
        })
        .returning(),
    );
    expect(row).toBeDefined();

    await expect(
      withTenant({ orgId: org.id }, (tx) =>
        tx.update(auditLog).set({ reason: "tamper" }).where(eq(auditLog.organizationId, org.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant({ orgId: org.id }, (tx) =>
        tx.delete(auditLog).where(eq(auditLog.organizationId, org.id)),
      ),
    ).rejects.toThrow();
  });
});

describe("append-only tables", () => {
  it.each(["audit_log", "unit_status_history", "unit_price_history", "lead_activity"])(
    "%s: the app role may insert but not update, delete or truncate",
    async (table) => {
      const { rows } = await db.execute<Record<string, boolean>>(sql`
        select
          has_table_privilege('realestate_app', ${`public.${table}`}, 'INSERT') as "insert",
          has_table_privilege('realestate_app', ${`public.${table}`}, 'UPDATE') as "update",
          has_table_privilege('realestate_app', ${`public.${table}`}, 'DELETE') as "delete",
          has_table_privilege('realestate_app', ${`public.${table}`}, 'TRUNCATE') as "truncate"`);
      expect(rows[0]).toEqual({ insert: true, update: false, delete: false, truncate: false });
    },
  );
});
