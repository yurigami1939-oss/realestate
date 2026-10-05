import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, invitation, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { auth } from "@/server/auth/auth";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { listMembers, listPendingInvitations } from "@/server/organizations/queries";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { TEST_PASSWORD, signIn } from "../../../tests/auth-helpers";
import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import type { PortalCtx } from "./context";
import { getPortalAccess, inviteToPortal, revokePortalLink } from "./invitations";
import { getPortalOverview } from "./queries";

afterAll(async () => {
  await stopEnqueue();
});

const newEmail = () => `client-${randomUUID().slice(0, 8)}@example.test`;

const buyerWith = async (ctx: TenantCtx, email: string) =>
  (
    await createBuyer(
      ctx,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        email,
        leadId: "",
      }),
    )
  ).id;

/** A buyer with a reservation, invited to the portal; the account is created and accepted. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const email = newEmail();
  const buyerId = await buyerWith(team.manager, email);
  const { id: reservationId } = await createReservation(
    team.manager,
    createReservationSchema.parse({
      unitId: setup.unitIds[0],
      buyerIds: [buyerId],
      paymentPlanId: setup.planId,
      discount: "",
      reservedOn: todayInAlgiers(),
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  return { team, setup, email, buyerId, reservationId };
}

/** The invited person creates their account with the invited e-mail and accepts. */
async function acceptAs(email: string, orgId: string) {
  const { user: created } = await auth.api.signUpEmail({
    body: { name: "Karim Bensalem", email, password: TEST_PASSWORD },
  });
  const headers = await signIn(email);
  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgId),
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
      ),
    );
  if (!pending) throw new Error("no pending invitation");
  await auth.api.acceptInvitation({ body: { invitationId: pending.id }, headers });
  const portal: PortalCtx = { userId: created.id, orgId, name: "Karim Bensalem", locale: "fr" };
  return portal;
}

describe("portal access", () => {
  it("invites a buyer by e-mail and shows the account only its own sales once accepted", async () => {
    const { team, email, buyerId, reservationId } = await scenario();
    const target = { kind: "buyer" as const, id: buyerId };

    await expect(inviteToPortal(team.agentA, target)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const withoutEmail = await buyerWith(team.manager, "");
    await expect(
      inviteToPortal(team.manager, { kind: "buyer", id: withoutEmail }),
    ).rejects.toMatchObject({ messageKey: "portal.errors.noEmail" });

    expect(await inviteToPortal(team.manager, target)).toEqual({ status: "invited" });
    // Inviting again renews the same invitation.
    expect(await inviteToPortal(team.manager, target)).toEqual({ status: "invited" });
    const invitations = await db
      .select({ role: invitation.role, status: invitation.status })
      .from(invitation)
      .where(and(eq(invitation.organizationId, team.orgId), eq(invitation.email, email)));
    expect(invitations).toEqual([{ role: "resident", status: "pending" }]);
    const { rows } = await db.execute<{ subject: string }>(sql`
      select data->>'subject' as subject from pgboss.job
      where name = 'email.send' and data->>'to' = ${email}
    `);
    expect(rows[0]?.subject).toContain("Votre espace client");
    expect(rows[0]?.subject).toContain("فضاء الزبون");
    // Portal invitations are not staff invitations.
    expect((await listPendingInvitations(team.orgId)).map((i) => i.email)).not.toContain(email);
    expect((await getPortalAccess(team.manager, [target])).get(buyerId)).toMatchObject({
      state: "invited",
      email,
    });

    const portal = await acceptAs(email, team.orgId);
    const access = (await getPortalAccess(team.manager, [target])).get(buyerId);
    expect(access?.state).toBe("active");
    expect((await getPortalOverview(portal)).sales.map((s) => s.id)).toEqual([reservationId]);
    expect((await listMembers(team.orgId)).map((m) => m.userId)).not.toContain(portal.userId);
    await expect(inviteToPortal(team.manager, target)).rejects.toMatchObject({
      messageKey: "portal.errors.alreadyActive",
    });

    // Another organization's sales stay invisible, even with a forged context.
    const other = await scenario();
    expect((await getPortalOverview({ ...portal, orgId: other.team.orgId })).sales).toEqual([]);

    await revokePortalLink(team.manager, access?.linkId ?? "");
    await expect(revokePortalLink(team.manager, access?.linkId ?? "")).rejects.toMatchObject({
      messageKey: "portal.errors.revoked",
    });
    expect((await getPortalOverview(portal)).sales).toEqual([]);
    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityType, "portal_link"))
        .orderBy(asc(auditLog.createdAt)),
    );
    expect(audit.map((a) => a.action)).toEqual(["portal.invite", "portal.invite", "portal.revoke"]);
  });

  it("adds a co-owner to an existing portal account at once and refuses staff e-mails", async () => {
    const { team, setup, email, buyerId } = await scenario();
    const manager = await addMember(team.orgId, ["property_manager"]);
    await inviteToPortal(team.manager, { kind: "buyer", id: buyerId });
    const portal = await acceptAs(email, team.orgId);

    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
      }),
    );
    const resident = (unitId: string, residentEmail: string) =>
      addResident(
        manager,
        addResidentSchema.parse({
          residenceId,
          unitId,
          kind: "co_owner",
          isMain: true,
          lastName: "Bensalem",
          firstName: "Karim",
          email: residentEmail,
          sinceOn: "2026-01-01",
        }),
      );
    const { id: coOwner } = await resident(setup.unitIds[1], email);
    // The gestionnaire manages co-owners, not buyer files.
    await expect(inviteToPortal(manager, { kind: "buyer", id: buyerId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await inviteToPortal(manager, { kind: "resident", id: coOwner })).toEqual({
      status: "linked",
    });
    expect((await getPortalOverview(portal)).units).toMatchObject([
      { residentId: coOwner, kind: "co_owner", unitCode: "A-03-02" },
    ]);

    // A staff member's e-mail cannot become a portal account of the same organization.
    const [staff] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, team.agentA.userId));
    const { id: staffResident } = await resident(setup.unitIds[2], staff?.email ?? "");
    await expect(
      inviteToPortal(manager, { kind: "resident", id: staffResident }),
    ).rejects.toMatchObject({ messageKey: "portal.errors.staffEmail" });
  });
});
