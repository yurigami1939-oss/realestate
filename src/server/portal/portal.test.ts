import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, invitation, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { renderAndStoreNotice } from "@/server/announcements/documents";
import { createAnnouncementSchema } from "@/server/announcements/schemas";
import { createAnnouncement, publishAnnouncement } from "@/server/announcements/service";
import { renderAndStoreConvocation } from "@/server/assemblies/documents";
import { addResolutionSchema, createAssemblySchema } from "@/server/assemblies/schemas";
import { addResolution, conveneAssembly, createAssembly } from "@/server/assemblies/service";
import { auth } from "@/server/auth/auth";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { approveBudget, saveBudget } from "@/server/charges/budgets";
import { issueChargePeriod } from "@/server/charges/calls";
import { createChargeCategory } from "@/server/charges/categories";
import { renderAndStoreChargeCall } from "@/server/charges/documents";
import { getChargePeriod } from "@/server/charges/queries";
import {
  createChargeCategorySchema,
  issueChargePeriodSchema,
  saveBudgetSchema,
} from "@/server/charges/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createReportSchema } from "@/server/construction/schemas";
import { addReportPhoto, createConstructionReport } from "@/server/construction/service";
import { getFileDownloadUrl } from "@/server/files/service";
import { listMembers, listPendingInvitations } from "@/server/organizations/queries";
import { renderAndStoreReceipt } from "@/server/payments/documents";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { commentTicketSchema } from "@/server/tickets/schemas";
import { commentTicket } from "@/server/tickets/service";

import { TEST_PASSWORD, signIn } from "../../../tests/auth-helpers";
import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import type { PortalCtx } from "./context";
import { getPortalAccess, inviteToPortal, revokePortalLink } from "./invitations";
import { getPortalOverview } from "./queries";
import {
  createPortalTicket,
  getPortalTicket,
  getPortalUnitAccount,
  listPortalAnnouncements,
  listPortalAssemblies,
  listPortalTickets,
} from "./residences";
import { getPortalSale } from "./sales";
import { portalTicketSchema } from "./schemas";

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

  it("shows a buyer their sale and its documents, and nothing of other sales", async () => {
    const { team, setup, email, buyerId, reservationId } = await scenario();
    await inviteToPortal(team.manager, { kind: "buyer", id: buyerId });
    const portal = await acceptAs(email, team.orgId);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const pay = async (saleId: string, amount: string) => {
      const { receiptId } = await recordPayment(
        cashier,
        recordPaymentSchema.parse({
          reservationId: saleId,
          amount,
          method: "cash",
          paidOn: todayInAlgiers(),
          payerName: "Karim Bensalem",
        }),
      );
      await renderAndStoreReceipt(team.orgId, receiptId);
    };
    await pay(reservationId, "1 000 000");

    const sale = await getPortalSale(portal, reservationId);
    expect(sale).toMatchObject({
      id: reservationId,
      unitCode: "A-03-01",
      buyers: [{ lastName: "Bensalem", firstName: "Karim" }],
      calls: [],
      loans: [],
    });
    expect(sale?.statement.paid).toBe(1_000_000_00n);
    expect(sale?.statement.lines).toHaveLength(3);
    expect(sale?.milestones.map((m) => m.name)).toEqual(["Fondations", "Gros œuvre"]);
    const receiptFile = sale?.payments[0]?.receiptPdfFileId ?? "";
    expect(receiptFile).not.toBe("");

    // Another buyer's sale of the same company: neither the sale nor its receipt.
    const neighbour = await buyerWith(team.manager, newEmail());
    const { id: otherSale } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[1],
        buyerIds: [neighbour],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: todayInAlgiers(),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await pay(otherSale, "500 000");
    expect(await getPortalSale(portal, otherSale)).toBeNull();

    // Downloads: the account's own receipt, never the neighbour's.
    const asMember: TenantCtx = { ...portal, roles: ["resident"] };
    expect(await getFileDownloadUrl(asMember, receiptFile, "inline")).toMatch(/^http/);
    const { rows } = await withTenant(team.owner, (tx) =>
      tx.execute<{ id: string }>(sql`
        select r.pdf_file_id as id from receipt r join payment p on p.id = r.payment_id
        where p.reservation_id = ${otherSale}
      `),
    );
    await expect(getFileDownloadUrl(asMember, rows[0]?.id ?? "", "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("shows a buyer the published progress of their building, with its photos", async () => {
    const { team, setup, email, buyerId, reservationId } = await scenario();
    await inviteToPortal(team.manager, { kind: "buyer", id: buyerId });
    const portal = await acceptAs(email, team.orgId);
    const technical = await addMember(team.orgId, ["technical_manager"]);
    const report = async (title: string, published: boolean, percent: string) => {
      const { id } = await createConstructionReport(
        technical,
        createReportSchema.parse({
          projectId: setup.projectId,
          reportedOn: todayInAlgiers(),
          title,
          titleAr: "",
          body: "",
          bodyAr: "",
          published,
          progress: [{ buildingId: setup.buildingId, percent }],
        }),
      );
      const upload = {
        fileName: "chantier.jpg",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      };
      return (await addReportPhoto(technical, { reportId: id, upload })).fileId;
    };
    const shown = await report("Dalle du 3e étage coulée", true, "45");
    const internal = await report("Note interne", false, "50");

    const sale = await getPortalSale(portal, reservationId);
    expect(sale?.progress?.percent).toBe(45);
    expect(sale?.reports.map((r) => r.title)).toEqual(["Dalle du 3e étage coulée"]);
    const asMember: TenantCtx = { ...portal, roles: ["resident"] };
    expect(await getFileDownloadUrl(asMember, shown, "inline")).toMatch(/^http/);
    await expect(getFileDownloadUrl(asMember, internal, "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("shows co-owners their charges and assemblies, occupants announcements and tickets", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const [coUnit, occupiedUnit] = setup.unitIds;
    const manager = await addMember(team.orgId, ["property_manager"]);
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
    const { id: categoryId } = await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Nettoyage",
        nameAr: "",
        key: "equal",
        weighting: "equal",
        buildingId: "",
        unitIds: [],
      }),
    );
    const { budgetId } = await saveBudget(
      manager,
      saveBudgetSchema.parse({
        residenceId,
        year: todayInAlgiers().slice(0, 4),
        lines: [{ categoryId, amount: "120 000" }],
        notes: "",
      }),
    );
    await approveBudget(manager, budgetId);
    const resident = async (unitId: string, kind: "co_owner" | "occupant", email: string) =>
      (
        await addResident(
          manager,
          addResidentSchema.parse({
            residenceId,
            unitId,
            kind,
            isMain: true,
            lastName: kind === "co_owner" ? "Saïdi" : "Benamar",
            firstName: kind === "co_owner" ? "Yasmine" : "Anis",
            email,
            sinceOn: "2026-01-01",
          }),
        )
      ).id;
    const coOwnerEmail = newEmail();
    const occupantEmail = newEmail();
    const coOwnerId = await resident(coUnit, "co_owner", coOwnerEmail);
    const occupantId = await resident(occupiedUnit, "occupant", occupantEmail);
    await inviteToPortal(manager, { kind: "resident", id: coOwnerId });
    await inviteToPortal(manager, { kind: "resident", id: occupantId });
    const coOwner = await acceptAs(coOwnerEmail, team.orgId);
    const occupant = await acceptAs(occupantEmail, team.orgId);
    const asMember = (portal: PortalCtx): TenantCtx => ({ ...portal, roles: ["resident"] });

    // Charges: the co-owner's own unit only; occupants see no charges.
    const { periodId } = await issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({
        period: `${budgetId}:1`,
        issuedOn: addDays(todayInAlgiers(), -5),
        dueOn: addDays(todayInAlgiers(), 25),
      }),
    );
    const callId = (await getChargePeriod(manager, periodId))?.calls[0]?.id ?? "";
    await renderAndStoreChargeCall(team.orgId, callId);
    const account = await getPortalUnitAccount(coOwner, coUnit);
    expect(account?.statement.lines).toHaveLength(1);
    expect(account?.statement.price).toBe(10_000_00n);
    expect(await getPortalUnitAccount(coOwner, occupiedUnit)).toBeNull();
    expect(await getPortalUnitAccount(occupant, occupiedUnit)).toBeNull();
    const callFile = account?.statement.lines[0]?.pdfFileId ?? "";
    expect(await getFileDownloadUrl(asMember(coOwner), callFile, "inline")).toMatch(/^http/);
    await expect(getFileDownloadUrl(asMember(occupant), callFile, "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Announcements: published ones only, for co-owners and occupants alike.
    const announce = async (title: string) =>
      (
        await createAnnouncement(
          manager,
          createAnnouncementSchema.parse({
            residenceId,
            category: "outage",
            title,
            titleAr: "",
            body: "Coupure jeudi matin.",
            bodyAr: "",
            expiresOn: "",
            pinned: false,
          }),
        )
      ).id;
    const published = await announce("Coupure d'eau");
    await announce("Brouillon");
    await publishAnnouncement(manager, published);
    await renderAndStoreNotice(team.orgId, published);
    const notices = await listPortalAnnouncements(occupant);
    expect(notices.map((a) => a.title)).toEqual(["Coupure d'eau"]);
    expect(
      await getFileDownloadUrl(asMember(occupant), notices[0]?.pdfFileId ?? "", "inline"),
    ).toMatch(/^http/);

    // Tickets: on the account's unit or the common areas, never someone else's unit.
    const report = (unitId: string) =>
      createPortalTicket(
        occupant,
        portalTicketSchema.parse({
          residenceId,
          unitId,
          title: "Fuite sous l'évier",
          description: "Depuis ce matin.",
          category: "plumbing",
          priority: "high",
        }),
      );
    const { id: own } = await report(occupiedUnit);
    await report("");
    await expect(report(coUnit)).rejects.toMatchObject({
      messageKey: "residences.errors.unitNotInResidence",
    });
    expect(await listPortalTickets(occupant)).toHaveLength(2);
    expect(await listPortalTickets(coOwner)).toEqual([]);
    expect(await getPortalTicket(coOwner, own)).toBeNull();
    await commentTicket(
      manager,
      commentTicketSchema.parse({ ticketId: own, comment: "Note interne" }),
    );
    expect((await getPortalTicket(occupant, own))?.events.map((e) => e.kind)).toEqual(["created"]);

    // Assemblies: co-owners only, with the convocation.
    const { id: assemblyId } = await createAssembly(
      manager,
      createAssemblySchema.parse({
        residenceId,
        kind: "ordinary",
        heldOn: addDays(todayInAlgiers(), 15),
        startTime: "18:00",
        place: "Hall",
        notes: "",
      }),
    );
    await addResolution(
      manager,
      addResolutionSchema.parse({
        assemblyId,
        title: "Budget",
        titleAr: "",
        description: "",
        majority: "simple",
      }),
    );
    expect(await listPortalAssemblies(coOwner)).toEqual([]);
    await conveneAssembly(manager, assemblyId);
    await renderAndStoreConvocation(team.orgId, assemblyId);
    const assemblies = await listPortalAssemblies(coOwner);
    expect(assemblies).toMatchObject([{ id: assemblyId, status: "convened" }]);
    expect(await listPortalAssemblies(occupant)).toEqual([]);
    const convocation = assemblies[0]?.convocationFileId ?? "";
    expect(await getFileDownloadUrl(asMember(coOwner), convocation, "inline")).toMatch(/^http/);
    await expect(
      getFileDownloadUrl(asMember(occupant), convocation, "inline"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
