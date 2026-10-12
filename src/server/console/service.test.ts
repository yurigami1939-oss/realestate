import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { addon, pilotGoal, subscription, tenantEntitlement, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import type { TenantCtx } from "@/server/auth/session";
import { inviteMember } from "@/server/organizations/service";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount } from "@/server/treasury/service";

import { createOrganizationAs, signUp } from "../../../tests/auth-helpers";
import {
  createTestPlan,
  ensureCatalogAddons,
  openTestAccount,
} from "../../../tests/console-fixtures";
import { createOrganization } from "../../../tests/factories";

import { systemOperator } from "./context";
import { getAccount, getConsoleOverview, listAccounts } from "./queries";
import { subscriptionTermsSchema } from "./schemas";
import {
  activateSubscription,
  addPilotGoal,
  repriceAddon,
  setSubscriptionAddon,
  updatePilotGoal,
  updateSubscriptionTerms,
} from "./service";

beforeAll(async () => {
  await ensureCatalogAddons();
});
afterAll(async () => {
  await stopEnqueue();
});

const modulesOf = async (orgId: string) =>
  (
    await withTenant({ orgId }, (tx) =>
      tx
        .select({ modules: tenantEntitlement.modules })
        .from(tenantEntitlement)
        .where(eq(tenantEntitlement.organizationId, orgId)),
    )
  )[0]?.modules;

const terms = (billingAccountId: string, values: Record<string, string>) =>
  subscriptionTermsSchema.parse({
    billingAccountId,
    planCode: "",
    billingPeriod: "yearly",
    price: "900000",
    discount: "",
    priceLockedUntil: "",
    pilotEndsOn: "",
    graceDays: "15",
    activeUnits: "",
    organizations: "",
    storageGb: "",
    ...values,
  });

describe("the operator's console (CLAUDE.console.md §10)", () => {
  it("changes a plan, never taking a module still in use nor raising a locked price", async () => {
    const org = await createOrganization({}, { entitle: false });
    const withTreasury = await createTestPlan({ modules: ["imports", "treasury"] });
    const withoutTreasury = await createTestPlan({ modules: ["imports", "reports"] });
    const { billingAccountId } = await openTestAccount([org.id], { planCode: withTreasury });

    // An open cash desk keeps the treasury.
    await createAccount(
      { userId: (await signUp("Gerant")).userId, orgId: org.id, roles: ["owner"], locale: "fr" },
      createAccountSchema.parse({
        kind: "cash",
        name: "Caisse",
        bankName: "",
        accountNumber: "",
        isDefault: true,
        notes: "",
        openingBalance: "0",
        openingOn: "2026-01-01",
      }),
    );
    await expect(
      updateSubscriptionTerms(
        systemOperator,
        terms(billingAccountId, { planCode: withoutTreasury }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "subscription.blocked.treasury" });

    // A founder price locked: down is fine, up is refused.
    const locked = addDays(todayInAlgiers(), 30);
    await updateSubscriptionTerms(
      systemOperator,
      terms(billingAccountId, {
        planCode: withTreasury,
        price: "800000",
        priceLockedUntil: locked,
      }),
    );
    await expect(
      updateSubscriptionTerms(
        systemOperator,
        terms(billingAccountId, {
          planCode: withTreasury,
          price: "850000",
          priceLockedUntil: locked,
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "console.errors.priceLocked" });
    // A plan of one company at most, for an account of two: refused.
    const solo = await createTestPlan({ modules: ["imports", "treasury"], organizations: "1" });
    const other = await createOrganization({}, { entitle: false });
    const two = await openTestAccount([
      other.id,
      (await createOrganization({}, { entitle: false })).id,
    ]);
    await expect(
      updateSubscriptionTerms(systemOperator, terms(two.billingAccountId, { planCode: solo })),
    ).rejects.toMatchObject({ messageKey: "console.errors.organizationsCap" });
  });

  it("takes and drops add-ons, their modules following in every organization", async () => {
    const org = await createOrganization({}, { entitle: false });
    const { billingAccountId } = await openTestAccount([org.id]);
    await setSubscriptionAddon(systemOperator, {
      billingAccountId,
      code: "rentals",
      on: true,
      price: 9_000_000n,
    });
    expect(await modulesOf(org.id)).toContain("rentals");
    const account = await getAccount(systemOperator, billingAccountId);
    expect(account?.addons.find((a) => a.addonCode === "rentals" && !a.removedOn)?.price).toBe(
      9_000_000n,
    );
    await setSubscriptionAddon(systemOperator, {
      billingAccountId,
      code: "rentals",
      on: false,
      price: null,
    });
    expect(await modulesOf(org.id)).not.toContain("rentals");
  });

  it("activates a pilot with its first period and keeps the pilot's goals", async () => {
    const org = await createOrganization({}, { entitle: false });
    const { billingAccountId } = await openTestAccount([org.id], { status: "pilot" });
    await addPilotGoal(systemOperator, { billingAccountId, label: "Importer les lots" });
    await addPilotGoal(systemOperator, { billingAccountId, label: "Émettre les reçus" });
    const [first] = await consoleDb
      .select()
      .from(pilotGoal)
      .innerJoin(subscription, eq(subscription.id, pilotGoal.subscriptionId))
      .where(eq(subscription.billingAccountId, billingAccountId))
      .orderBy(pilotGoal.position);
    await updatePilotGoal(systemOperator, { goalId: first!.pilot_goal.id, done: true });

    await activateSubscription(systemOperator, { billingAccountId, startsOn: "2026-11-01" });
    const account = await getAccount(systemOperator, billingAccountId);
    expect(account?.subscription).toMatchObject({
      status: "active",
      currentPeriodStart: "2026-11-01",
      currentPeriodEnd: "2027-10-31",
    });
    expect(account?.goals.map((g) => [g.label, g.doneOn !== null])).toEqual([
      ["Importer les lots", true],
      ["Émettre les reçus", false],
    ]);
    expect(account?.trail.map((r) => r.action)).toContain("subscription.status_change");
  });

  it("lists and searches the accounts, and lists the pilots ending this week", async () => {
    const name = `Promotion ${randomUUID().slice(0, 6)}`;
    const org = await createOrganization({ name }, { entitle: false });
    const { billingAccountId } = await openTestAccount([org.id], {
      status: "pilot",
      pilotEndsOn: addDays(todayInAlgiers(), 3),
    });
    const found = await listAccounts(systemOperator, { q: name, status: "pilot" });
    expect(found.map((a) => a.id)).toEqual([billingAccountId]);
    expect(found[0]?.companies).toBe(name);
    const { pilotsEnding } = await getConsoleOverview(systemOperator);
    expect(pilotsEnding.map((p) => p.id)).toContain(billingAccountId);
  });

  it("reprices an add-on as a new catalog row, the old one archived", async () => {
    const [before] = await consoleDb.select().from(addon).where(eq(addon.code, "whatsapp"));
    await repriceAddon(systemOperator, {
      code: "whatsapp",
      yearlyPrice: 65_000_00n,
      quarterlyPrice: 19_500_00n,
    });
    const live = await consoleDb.select().from(addon).where(eq(addon.code, "whatsapp"));
    expect(live.filter((a) => !a.archivedAt).map((a) => a.yearlyPrice)).toEqual([65_000_00n]);
    expect(live.length).toBeGreaterThan(before ? 1 : 0);
  });

  it("never lets an operator be invited into an organization", async () => {
    const owner = await signUp("Gerant");
    const org = await createOrganizationAs(owner.headers);
    const operator = await signUp("Operateur");
    await db.update(user).set({ role: OPERATOR_ROLE }).where(eq(user.id, operator.userId));
    const ctx: TenantCtx = { userId: owner.userId, orgId: org.id, roles: ["owner"], locale: "fr" };
    await expect(
      inviteMember(ctx, owner.headers, { email: operator.email, roles: ["cashier"] }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "members.errors.operatorEmail" });
  });
});
