import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { invitation, provision, tenantEntitlement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { auth } from "@/server/auth/auth";

import {
  createTestPlan,
  ensureCatalogAddons,
  openTestAccount,
} from "../../../tests/console-fixtures";
import { createOrganization, createUser } from "../../../tests/factories";

import { systemOperator } from "./context";
import { getAccount } from "./queries";
import {
  completeProvision,
  createProvision,
  findLiveProvision,
  revokeProvision,
} from "./provisions";

beforeAll(async () => {
  await ensureCatalogAddons();
});
afterAll(async () => {
  await stopEnqueue();
});

const tokenOf = (url: string) => new URL(url).searchParams.get("provision") ?? "";
const freshEmail = () => `promoteur-${randomUUID().slice(0, 8)}@example.test`;

async function invite(values: { planCode?: string; billingAccountId?: string | null } = {}) {
  const email = freshEmail();
  const planCode = values.billingAccountId ? null : (values.planCode ?? (await createTestPlan()));
  const { id, url } = await createProvision(systemOperator, {
    email,
    legalName: "SARL Promotion Tafna",
    billingAccountId: values.billingAccountId ?? null,
    planCode,
    program: "standard",
    pilotDays: 45,
  });
  return { id, email, token: tokenOf(url) };
}

/** A sign-up as a browser would post it (the closed sign-up only checks requests). */
const signUpRequest = (email: string) =>
  auth.handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Promoteur", email, password: "un-mot-de-passe-solide" }),
    }),
  );

describe("provisions (CLAUDE.console.md §8)", () => {
  it("keeps only the token's hash and e-mails the link", async () => {
    const { id, email, token } = await invite();
    expect(token).toMatch(/^prv_/);
    const [row] = await consoleDb.select().from(provision).where(eq(provision.id, id));
    expect(row?.tokenHash).not.toContain(token);
    expect(row?.tokenHash).toHaveLength(64);
    const { rows } = await db.execute<{ html: string }>(
      sql`select data->>'html' as html from pgboss.job where name = 'email.send' and data->>'to' = ${email}`,
    );
    expect(rows[0]?.html).toContain(token);
    expect((await findLiveProvision(token))?.email).toBe(email);
  });

  it("opens a new client piloting its plan, once, for its own e-mail only", async () => {
    const { email, token } = await invite();
    const org = await createOrganization({}, { entitle: false });
    await expect(
      completeProvision({ token, organizationId: org.id, email: "autre@example.test" }),
    ).rejects.toMatchObject({ messageKey: "console.errors.provisionEmail" });

    const { billingAccountId } = await completeProvision({
      token,
      organizationId: org.id,
      email: email.toUpperCase(),
    });
    const account = await getAccount(systemOperator, billingAccountId);
    expect(account?.subscription).toMatchObject({
      status: "pilot",
      pilotEndsOn: addDays(todayInAlgiers(), 45),
    });
    const [row] = await withTenant({ orgId: org.id }, (tx) =>
      tx.select().from(tenantEntitlement).where(eq(tenantEntitlement.organizationId, org.id)),
    );
    expect(row?.status).toBe("pilot");

    const again = await createOrganization({}, { entitle: false });
    await expect(
      completeProvision({ token, organizationId: again.id, email }),
    ).rejects.toMatchObject({ messageKey: "console.errors.provisionClosed" });
    expect(await findLiveProvision(token)).toBeNull();
  });

  it("refuses a revoked or expired link", async () => {
    const revoked = await invite();
    await revokeProvision(systemOperator, revoked.id);
    const expired = await invite();
    await consoleDb
      .update(provision)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(provision.id, expired.id));
    for (const { token, email } of [revoked, expired]) {
      const org = await createOrganization({}, { entitle: false });
      await expect(
        completeProvision({ token, organizationId: org.id, email }),
      ).rejects.toMatchObject({ messageKey: "console.errors.provisionClosed" });
    }
  });

  it("adds another SARL to its client's account within the plan's cap", async () => {
    const first = await createOrganization({}, { entitle: false });
    const planCode = await createTestPlan({ organizations: "2" });
    const { billingAccountId } = await openTestAccount([first.id], { planCode });
    const { email, token } = await invite({ billingAccountId });
    const second = await createOrganization({}, { entitle: false });
    await completeProvision({ token, organizationId: second.id, email });
    const account = await getAccount(systemOperator, billingAccountId);
    expect(account?.organizations.map((o) => o.id)).toEqual([first.id, second.id]);
    // The plan holds two companies: a third is refused when the link is made.
    await expect(invite({ billingAccountId })).rejects.toMatchObject({
      messageKey: "console.errors.organizationsCap",
    });
  });

  it("keeps sign-up closed but for an invitation or a provision", async () => {
    const closed = await signUpRequest(freshEmail());
    expect(closed.status).toBe(403);
    expect(await closed.json()).toMatchObject({ code: "SIGNUP_CLOSED" });

    const { email } = await invite();
    expect((await signUpRequest(email)).status).toBe(200);

    const org = await createOrganization();
    const inviter = await createUser();
    const invited = freshEmail();
    await db.insert(invitation).values({
      organizationId: org.id,
      email: invited,
      role: "cashier",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: inviter.id,
    });
    expect((await signUpRequest(invited)).status).toBe(200);
  });
});
