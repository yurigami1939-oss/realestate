import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { member } from "@/db/schema";
import { stopEnqueue } from "@/jobs/enqueue";
import { getPendingInvitation } from "@/server/organizations/queries";

import { createOrganizationAs as createOrg, signIn, signUp } from "../../../tests/auth-helpers";

import { auth } from "./auth";

afterAll(async () => {
  await stopEnqueue();
});

describe("organizations and roles (Better Auth)", () => {
  it("makes the creator owner and activates their organization on the next sign-in", async () => {
    const owner = await signUp("Owner");
    const org = await createOrg(owner.headers);

    const [membership] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, org.id));
    expect(membership?.role).toBe("owner");

    const headers = await signIn(owner.email);
    const current = await auth.api.getSession({ headers });
    expect(current?.session.activeOrganizationId).toBe(org.id);
  });

  it("lets the owner invite with several roles and queues a bilingual email", async () => {
    const owner = await signUp("Owner");
    const org = await createOrg(owner.headers);
    const email = `cashier-${randomUUID().slice(0, 8)}@example.test`;

    const invitation = await auth.api.createInvitation({
      body: { email, role: ["cashier", "accountant"], organizationId: org.id },
      headers: owner.headers,
    });

    const pending = await getPendingInvitation(invitation.id);
    expect(pending).toMatchObject({
      email,
      roles: ["cashier", "accountant"],
      organizationName: org.name,
    });

    const { rows } = await db.execute<{ subject: string }>(sql`
      select data->>'subject' as subject from pgboss.job
      where name = 'email.send' and data->>'to' = ${email}
    `);
    expect(rows[0]?.subject).toContain(org.name);
    expect(rows[0]?.subject).toContain("دعوة");
  });

  it("refuses invitations from a member without invitation:create", async () => {
    const owner = await signUp("Owner");
    const org = await createOrg(owner.headers);
    const cashier = await signUp("Cashier");

    const invitation = await auth.api.createInvitation({
      body: { email: cashier.email, role: "cashier", organizationId: org.id },
      headers: owner.headers,
    });
    await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: cashier.headers,
    });

    const [membership] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.role, "cashier")));
    expect(membership).toBeDefined();
    expect(await getPendingInvitation(invitation.id)).toBeNull();

    await expect(
      auth.api.createInvitation({
        body: { email: "someone@example.test", role: "sales_agent", organizationId: org.id },
        headers: cashier.headers,
      }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("leaves the active organization empty for a user without membership", async () => {
    const outsider = await signUp("Outsider");
    const current = await auth.api.getSession({ headers: outsider.headers });
    expect(current?.session.activeOrganizationId ?? null).toBeNull();
  });
});
