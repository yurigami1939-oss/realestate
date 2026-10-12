import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { auditLog, consoleAuditLog, tenantEntitlement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { assertWritable, loadTenantAccess, tenantWritable } from "@/server/entitlements/access";

import { ensureCatalogAddons, openTestAccount } from "../../../tests/console-fixtures";
import { addMember, createOrganization } from "../../../tests/factories";

import { systemOperator } from "./context";
import { changeSubscriptionStatus, PILOT_WARNING_DAYS, runConsoleDaily } from "./lifecycle";

beforeAll(async () => {
  await ensureCatalogAddons();
});

const statusOf = async (orgId: string) =>
  (
    await withTenant({ orgId }, (tx) =>
      tx
        .select({ status: tenantEntitlement.status })
        .from(tenantEntitlement)
        .where(eq(tenantEntitlement.organizationId, orgId)),
    )
  )[0]?.status;

describe("subscription lifecycle (CLAUDE.console.md §6)", () => {
  it("suspends with a reason, read-only everywhere, audited in each organization", async () => {
    const [a, b] = await Promise.all([
      createOrganization({}, { entitle: false }),
      createOrganization({}, { entitle: false }),
    ]);
    const { billingAccountId } = await openTestAccount([a.id, b.id]);

    await expect(
      changeSubscriptionStatus(systemOperator, { billingAccountId, to: "suspended" }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "console.errors.reasonRequired" });
    await changeSubscriptionStatus(systemOperator, {
      billingAccountId,
      to: "suspended",
      reason: "Factures impayées",
    });
    expect(await statusOf(a.id)).toBe("suspended");
    expect(await statusOf(b.id)).toBe("suspended");

    const access = await loadTenantAccess(a.id);
    expect(access.readOnly).toBe(true);
    expect(() => assertWritable({ access })).toThrow(
      expect.objectContaining({ messageKey: "errors.readOnly.suspended" }),
    );
    expect(await tenantWritable(b.id)).toBe(false);

    for (const org of [a, b]) {
      const rows = await withTenant({ orgId: org.id }, (tx) =>
        tx
          .select({ after: auditLog.after, reason: auditLog.reason })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.organizationId, org.id),
              eq(auditLog.action, "subscription.status_change"),
            ),
          ),
      );
      expect(rows).toEqual([{ after: { status: "suspended" }, reason: "Factures impayées" }]);
    }
    const trail = await consoleDb
      .select({ action: consoleAuditLog.action })
      .from(consoleAuditLog)
      .where(eq(consoleAuditLog.billingAccountId, billingAccountId));
    expect(trail.map((r) => r.action)).toContain("subscription.status_change");

    await changeSubscriptionStatus(systemOperator, { billingAccountId, to: "active" });
    expect(await tenantWritable(a.id)).toBe(true);
  });

  it("refuses a transition the lifecycle does not have", async () => {
    const org = await createOrganization({}, { entitle: false });
    const { billingAccountId } = await openTestAccount([org.id]);
    await changeSubscriptionStatus(systemOperator, {
      billingAccountId,
      to: "terminated",
      reason: "Fin du contrat",
    });
    await expect(
      changeSubscriptionStatus(systemOperator, { billingAccountId, to: "active" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    // Back to suspended before the purge only.
    await changeSubscriptionStatus(systemOperator, {
      billingAccountId,
      to: "suspended",
      reason: "Reprise des échanges",
    });
    expect(await statusOf(org.id)).toBe("suspended");
  });

  it("puts a pilot over in past due, back to active once activated, and warns a week before", async () => {
    const today = todayInAlgiers();
    const over = await createOrganization({}, { entitle: false });
    const { billingAccountId: overAccount } = await openTestAccount([over.id], {
      status: "pilot",
      pilotEndsOn: addDays(today, -1),
    });
    const ending = await createOrganization({}, { entitle: false });
    const gerant = await addMember(ending.id, ["owner"]);
    await openTestAccount([ending.id], {
      status: "pilot",
      pilotEndsOn: addDays(today, PILOT_WARNING_DAYS),
    });

    await runConsoleDaily(today);
    expect(await statusOf(over.id)).toBe("past_due");
    // Still writable: past due never blocks the work.
    expect(await tenantWritable(over.id)).toBe(true);
    expect(await statusOf(ending.id)).toBe("pilot");
    const [{ email }] = await db
      .execute<{ email: string }>(sql`select email from "user" where id = ${gerant.userId}`)
      .then((r) => r.rows as [{ email: string }]);
    const { rows } = await db.execute<{ subject: string }>(
      sql`select data->>'subject' as subject from pgboss.job
          where name = 'email.send' and data->>'to' = ${email}`,
    );
    expect(rows.map((r) => r.subject)).toEqual([expect.stringContaining("7 jours")]);

    // The operator activates it: active, and the daily job leaves it so.
    await changeSubscriptionStatus(systemOperator, { billingAccountId: overAccount, to: "active" });
    await runConsoleDaily(today);
    expect(await statusOf(over.id)).toBe("active");
  });

  it("lets only the online payments' re-check and refund run while read-only", () => {
    const root = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(root);
    const allowed = files.flatMap((path) =>
      [
        ...readFileSync(path, "utf8").matchAll(
          /export const (\w+) = defineAction\(\s*\{[^}]*allowWhenReadOnly: true/g,
        ),
      ].map((m) => m[1]),
    );
    expect(allowed.sort()).toEqual(["recheckOnlinePaymentAction", "refundOnlinePaymentAction"]);
  });
});
