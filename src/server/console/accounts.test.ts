import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { withConsoleTenant } from "@/db/console-tenant";
import { consoleAuditLog, tenantEntitlement } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import { createOrganization } from "../../../tests/factories";
import {
  createTestPlan,
  ensureCatalogAddons,
  openTestAccount,
} from "../../../tests/console-fixtures";

import { attachOrganization } from "./accounts";
import { systemOperator } from "./context";

beforeAll(async () => {
  await ensureCatalogAddons();
});

const entitlementOf = (orgId: string) =>
  withTenant({ orgId }, (tx) =>
    tx.select().from(tenantEntitlement).where(eq(tenantEntitlement.organizationId, orgId)),
  );

describe("client accounts and entitlements (CLAUDE.console.md §3)", () => {
  it("entitles every organization of an account to its plan and add-ons", async () => {
    const [a, b] = await Promise.all([
      createOrganization({}, { entitle: false }),
      createOrganization({}, { entitle: false }),
    ]);
    const { billingAccountId } = await openTestAccount([a.id, b.id], {
      addons: [{ code: "syndic" }, { code: "rentals", price: "90000" }],
    });

    for (const org of [a, b]) {
      const [row] = await entitlementOf(org.id);
      expect(row?.status).toBe("active");
      expect(row?.modules).toEqual(["imports", "treasury", "portal", "syndic", "rentals"]);
      expect(row?.limits).toEqual({ activeUnits: 300, organizations: 2, storageGb: 100 });
    }

    const audit = await consoleDb
      .select({ action: consoleAuditLog.action, after: consoleAuditLog.after })
      .from(consoleAuditLog)
      .where(eq(consoleAuditLog.billingAccountId, billingAccountId));
    expect(audit.map((r) => r.action)).toEqual(["billing_account.open"]);
    expect(audit[0]?.after).toMatchObject({
      status: "active",
      price: "90000000",
      addons: [
        { code: "syndic", price: "30000" },
        { code: "rentals", price: "9000000" },
      ],
    });
  });

  it("starts a pilot for 30 days (90 for a design partner)", async () => {
    const org = await createOrganization({}, { entitle: false });
    await openTestAccount([org.id], { status: "pilot", program: "design_partner" });
    const [row] = await entitlementOf(org.id);
    expect(row?.status).toBe("pilot");
    const days = (Date.parse(row?.pilotEndsOn ?? "") - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBeGreaterThanOrEqual(89);
    expect(Math.round(days)).toBeLessThanOrEqual(91);
  });

  it("keeps each organization's entitlement to itself", async () => {
    const [a, b] = await Promise.all([
      createOrganization({}, { entitle: false }),
      createOrganization({}, { entitle: false }),
    ]);
    await openTestAccount([a.id]);
    const seenFromB = await withTenant({ orgId: b.id }, (tx) =>
      tx.select().from(tenantEntitlement).where(eq(tenantEntitlement.organizationId, a.id)),
    );
    expect(seenFromB).toEqual([]);
    // Without an organization set, the console sees no tenant row either.
    const { rows } = await consoleDb.execute<{ n: number }>(
      sql`select count(*)::int as n from tenant_entitlement`,
    );
    expect(rows[0]?.n).toBe(0);
    const [own] = await withConsoleTenant(a.id, (tx) =>
      tx.select().from(tenantEntitlement).where(eq(tenantEntitlement.organizationId, a.id)),
    );
    expect(own?.status).toBe("active");
  });

  it("never lets the app write an entitlement", async () => {
    const org = await createOrganization({}, { entitle: false });
    await openTestAccount([org.id]);
    await expect(
      withTenant({ orgId: org.id }, (tx) =>
        tx
          .update(tenantEntitlement)
          .set({ modules: ["imports", "syndic"] })
          .where(eq(tenantEntitlement.organizationId, org.id)),
      ),
    ).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org', ${org.id}, true)`);
        await tx.execute(sql`delete from tenant_entitlement where organization_id = ${org.id}`);
      }),
    ).rejects.toThrow();
  });

  it("adds a SARL within the plan's cap, never an organization another client holds", async () => {
    const plan = await createTestPlan({ organizations: "2" });
    const [a, b, c] = await Promise.all([
      createOrganization({}, { entitle: false }),
      createOrganization({}, { entitle: false }),
      createOrganization({}, { entitle: false }),
    ]);
    const { billingAccountId } = await openTestAccount([a.id], { planCode: plan });
    await attachOrganization(systemOperator, { billingAccountId, organizationId: b.id });
    expect((await entitlementOf(b.id))[0]?.status).toBe("active");

    await expect(
      attachOrganization(systemOperator, { billingAccountId, organizationId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "console.errors.organizationsCap" });
    await expect(openTestAccount([b.id])).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "console.errors.alreadyAttached",
    });
    expect(await entitlementOf(c.id)).toEqual([]);
  });

  it("refuses an unknown or archived plan, and more organizations than the plan allows", async () => {
    const org = await createOrganization({}, { entitle: false });
    await expect(openTestAccount([org.id], { planCode: "no-such-plan" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const solo = await createTestPlan({ organizations: "1" });
    const other = await createOrganization({}, { entitle: false });
    await expect(openTestAccount([org.id, other.id], { planCode: solo })).rejects.toMatchObject({
      messageKey: "console.errors.organizationsCap",
    });
  });
});
