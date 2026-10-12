import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { auditLog, plan, tenantEntitlement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { consoleDb } from "@/db/console-client";
import { DEFAULT_PLAN_CODE, startPilotForNewOrganization } from "@/server/console/accounts";
import type { TenantCtx } from "@/server/auth/session";
import { listCaptureKeys } from "@/server/crm/capture";
import { buildExport } from "@/server/exports/service";
import { getReports } from "@/server/reports/queries";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount, resolvePaymentAccount } from "@/server/treasury/service";
import { listAccountChoices } from "@/server/treasury/queries";

import {
  createTestPlan,
  ensureCatalogAddons,
  openTestAccount,
} from "../../../tests/console-fixtures";
import { addMember, createOrganization } from "../../../tests/factories";

import { loadTenantAccess } from "./access";
import { getTenantSubscription } from "./subscription";
import { setModuleEnabled } from "./switches";

beforeAll(async () => {
  await ensureCatalogAddons();
});

/** A gérant of a fresh organization on a plan with these modules, as a request sees them. */
async function gerantWith(modules: string[], addons: { code: string }[] = []) {
  const org = await createOrganization({}, { entitle: false });
  const planCode = await createTestPlan({ modules });
  await openTestAccount([org.id], { planCode, addons });
  const owner = await addMember(org.id, ["owner"]);
  return withAccess(owner);
}

const withAccess = async (ctx: TenantCtx): Promise<TenantCtx> => ({
  ...ctx,
  access: await loadTenantAccess(ctx.orgId),
});

const account = (name: string) =>
  createAccountSchema.parse({
    kind: "bank",
    name,
    bankName: "BNA",
    accountNumber: "",
    isDefault: true,
    notes: "",
    openingBalance: "0",
    openingOn: "2026-01-01",
  });

const t = ((key: string) => key) as unknown as Parameters<typeof buildExport>[4];

describe("modules of an organization (CLAUDE.console.md §5)", () => {
  it("refuses what the plan does not include, by permission or by module", async () => {
    const ctx = await gerantWith(["imports", "reports"]);
    expect(ctx.access?.modules).toEqual(["imports", "reports"]);

    await expect(createAccount(ctx, account("BNA"))).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "errors.moduleOff",
    });
    await expect(listCaptureKeys(ctx)).rejects.toMatchObject({ messageKey: "errors.moduleOff" });
    await expect(buildExport(ctx, "ledger", {}, "fr", t)).rejects.toMatchObject({
      messageKey: "errors.moduleOff",
    });
    expect(await listAccountChoices(ctx)).toEqual([]);
    // Core and entitled modules work.
    await expect(getReports(ctx, {})).resolves.toBeTruthy();
  });

  it("fails closed for an organization without entitlement", async () => {
    const org = await createOrganization({}, { entitle: false });
    const ctx = await withAccess(await addMember(org.id, ["owner"]));
    expect(ctx.access).toMatchObject({ status: null, modules: [], readOnly: true });
    await expect(getReports(ctx, {})).rejects.toMatchObject({ messageKey: "errors.moduleOff" });
  });

  it("lands no payment on an account while the treasury is off", async () => {
    const ctx = await gerantWith(["treasury"]);
    await createAccount(ctx, account("BNA"));
    expect(
      await withTenant(ctx, (tx) => resolvePaymentAccount(tx, "bank_transfer", null)),
    ).not.toBeNull();
    // The same organization once its plan no longer has the treasury: no account.
    const without = await gerantWith(["reports"]);
    await createAccount({ ...without, access: undefined }, account("CPA"));
    expect(
      await withTenant(without, (tx) => resolvePaymentAccount(tx, "bank_transfer", null)),
    ).toBeNull();
  });

  it("switches a module off and on again, never while it is still used", async () => {
    const ctx = await gerantWith(["treasury", "reports", "portal"], [{ code: "online_payment" }]);
    expect(ctx.access?.modules).toEqual(["treasury", "reports", "portal", "online_payment"]);

    await setModuleEnabled(ctx, { module: "reports", on: false });
    const after = await withAccess(ctx);
    expect(after.access?.modules).not.toContain("reports");
    expect(after.access?.disabled).toEqual(["reports"]);
    await expect(getReports(after, {})).rejects.toMatchObject({ messageKey: "errors.moduleOff" });
    await setModuleEnabled(after, { module: "reports", on: true });
    expect((await withAccess(ctx)).access?.modules).toContain("reports");

    await createAccount(ctx, account("BNA"));
    await expect(setModuleEnabled(ctx, { module: "treasury", on: false })).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "subscription.blocked.treasury",
      details: { count: 1 },
    });
    await expect(setModuleEnabled(ctx, { module: "portal", on: false })).rejects.toMatchObject({
      messageKey: "subscription.errors.dependant",
      details: { module: "online_payment" },
    });
    await setModuleEnabled(ctx, { module: "online_payment", on: false });
    await setModuleEnabled(ctx, { module: "portal", on: false });
    await expect(
      setModuleEnabled(ctx, { module: "online_payment", on: true }),
    ).rejects.toMatchObject({ messageKey: "subscription.errors.needs" });
    await expect(setModuleEnabled(ctx, { module: "syndic", on: true })).rejects.toMatchObject({
      messageKey: "subscription.errors.notIncluded",
    });

    const audit = await withTenant(ctx, (tx) =>
      tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(eq(auditLog.organizationId, ctx.orgId), eq(auditLog.action, "organization.modules")),
        ),
    );
    expect(audit.at(-1)?.after).toEqual({ disabled: ["online_payment", "portal"] });
  });

  it("shows the subscription and where each module comes from", async () => {
    const ctx = await gerantWith(["treasury", "portal"], [{ code: "syndic" }]);
    const { subscription, modules } = await getTenantSubscription(ctx);
    expect(subscription).toMatchObject({ status: "active", billingPeriod: "yearly" });
    expect(subscription?.addons.map((a) => a.code)).toEqual(["syndic"]);
    expect(subscription?.organizations.map((o) => o.id)).toEqual([ctx.orgId]);
    const row = (m: string) => modules.find((r) => r.module === m);
    expect(row("treasury")).toMatchObject({ source: "plan", on: true });
    expect(row("syndic")).toMatchObject({ source: "addon", on: true });
    expect(row("rentals")).toMatchObject({ source: null, on: false });
    expect(row("online_payment")?.needs).toEqual(["portal"]);

    const loner = await withAccess(
      await addMember((await createOrganization({}, { entitle: false })).id, ["owner"]),
    );
    expect((await getTenantSubscription(loner)).subscription).toBeNull();
  });

  it("starts a pilot on the default plan for an organization created from the onboarding", async () => {
    const [existing] = await consoleDb
      .select({ id: plan.id })
      .from(plan)
      .where(eq(plan.code, DEFAULT_PLAN_CODE));
    if (!existing) {
      await createTestPlan({ code: DEFAULT_PLAN_CODE, modules: ["imports", "treasury"] }).catch(
        () => undefined,
      );
    }
    const org = await createOrganization({}, { entitle: false });
    await startPilotForNewOrganization(org.id);
    const [row] = await withTenant({ orgId: org.id }, (tx) =>
      tx.select().from(tenantEntitlement).where(eq(tenantEntitlement.organizationId, org.id)),
    );
    expect(row?.status).toBe("pilot");
    // Never twice, never failing the organization's creation (the refusal is only logged).
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(startPilotForNewOrganization(org.id)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
