import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";

const APP = "realestate_app";
const CONSOLE = "realestate_console";

/** Table privileges a role holds on a schema's tables (pg_class ACLs, readable by any role). */
async function privileges(role: string, schema: string) {
  const { rows } = await db.execute<{ table: string; privilege: string }>(sql`
    select c.relname as table, a.privilege_type as privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = ${schema} and c.relkind = 'r'
      and a.grantee = (select oid from pg_roles where rolname = ${role})
    order by 1, 2
  `);
  return rows.map((r) => `${r.table}:${r.privilege}`);
}

describe("console catalog (CLAUDE.console.md §3)", () => {
  it("lets the app role reach nothing in schema console but the tenant functions", async () => {
    expect(await privileges(APP, "console")).toEqual([]);
    const { rows } = await db.execute<{ name: string }>(sql`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'console' and has_function_privilege(${APP}, p.oid, 'EXECUTE')
      order by 1
    `);
    expect(rows.map((r) => r.name)).toEqual([
      "tenant_capacity",
      "tenant_invoices",
      "tenant_payment_details",
      "tenant_subscription",
    ]);
  });

  it("lets the app read its entitlement, never write it", async () => {
    const own = (await privileges(APP, "public")).filter((p) =>
      p.startsWith("tenant_entitlement:"),
    );
    expect(own).toEqual(["tenant_entitlement:SELECT"]);
  });

  it("gives the console role exactly its grants on public", async () => {
    expect(await privileges(CONSOLE, "public")).toEqual([
      "audit_log:INSERT",
      "member:SELECT",
      "organization:SELECT",
      "tenant_entitlement:INSERT",
      "tenant_entitlement:SELECT",
      "tenant_entitlement:UPDATE",
      "user:SELECT",
    ]);
  });

  it("keeps the console's audit trail append-only and its accounts undeletable", async () => {
    const granted = await privileges(CONSOLE, "console");
    expect(granted.filter((p) => p.startsWith("audit_log:"))).toEqual([
      "audit_log:INSERT",
      "audit_log:SELECT",
    ]);
    for (const table of [
      "billing_account",
      "plan",
      "addon",
      "subscription",
      "subscription_addon",
    ]) {
      expect(granted).toContain(`${table}:UPDATE`);
      expect(granted).not.toContain(`${table}:DELETE`);
    }
    expect(granted.some((p) => p.endsWith(":TRUNCATE"))).toBe(false);
  });

  it("connects the console as a role that cannot bypass RLS nor owns anything", async () => {
    const { rows } = await consoleDb.execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owns: boolean;
    }>(sql`
      select r.rolsuper, r.rolbypassrls,
             exists (select 1 from pg_tables t where t.tableowner = current_user) as owns
      from pg_roles r where r.rolname = current_user
    `);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: false });
  });
});
