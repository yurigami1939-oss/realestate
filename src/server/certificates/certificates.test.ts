import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, certificate, file, portalLink } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { clearChequeSchema, recordPaymentSchema } from "@/server/payments/schemas";
import { clearCheque, recordPayment } from "@/server/payments/service";
import type { PortalCtx } from "@/server/portal/context";
import { getPortalSale } from "@/server/portal/sales";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { certificateHtml, loadCertificateDocument, renderAndStoreCertificate } from "./documents";
import { listSaleCertificates } from "./queries";
import { issueCertificateSchema } from "./schemas";
import { issueCertificate, issuePortalStatement } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const year = today.slice(0, 4);

/** A reservation signed today (13 010 000 DA) with a cashier and an accountant. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const { id: buyerId } = await createBuyer(
    team.manager,
    createBuyerSchema.parse({
      lastName: "Bensalem",
      firstName: "Karim",
      lastNameAr: "بن سالم",
      firstNameAr: "كريم",
      nin: "109870123456789012",
      birthDate: "1985-04-12",
      birthPlace: "Kouba",
      phone: "0550 12 34 56",
      email: "",
      leadId: "",
    }),
  );
  const { id: saleId } = await createReservation(
    team.manager,
    createReservationSchema.parse({
      unitId: setup.unitIds[0],
      buyerIds: [buyerId],
      paymentPlanId: setup.planId,
      discount: "",
      reservedOn: today,
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  const cashier = await addMember(team.orgId, ["cashier"]);
  const accountant = await addMember(team.orgId, ["accountant"]);
  const pay = (amount: string, method: "bank_transfer" | "cheque" = "bank_transfer") =>
    recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount,
        method,
        paidOn: today,
        reference: method === "cheque" ? "CHQ-0042" : "VIR-12",
        bank: method === "cheque" ? "BNA" : "",
        payerName: "Bensalem Karim",
      }),
    );
  return { team, setup, buyerId, saleId, cashier, accountant, pay };
}

const issue = (ctx: TenantCtx, reservationId: string, kind: string, addressee = "") =>
  issueCertificate(ctx, issueCertificateSchema.parse({ reservationId, kind, addressee }));

describe("certificates", () => {
  it("issues numbered attestations with what the sale holds, frozen at issue", async () => {
    const { team, saleId, accountant, pay } = await scenario();
    await expect(issue(team.agentA, saleId, "reservation")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(issue(accountant, saleId, "payments")).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "certificates.errors.nothingPaid",
    });

    const booking = await issue(
      team.manager,
      saleId,
      "reservation",
      "CNEP Banque, agence de Kouba",
    );
    expect(booking.number).toBe(`ATT-${year}-000001`);
    await pay("2 602 000");
    const versements = await issue(accountant, saleId, "payments");
    expect(versements.number).toBe(`ATT-${year}-000002`);
    await expect(issue(accountant, saleId, "paid_in_full")).rejects.toMatchObject({
      messageKey: "certificates.errors.notPaidInFull",
    });

    const loaded = await withTenant(team.owner, (tx) => loadCertificateDocument(tx, versements.id));
    expect(loaded?.doc.data.totals).toMatchObject({
      paid: "260200000",
      remaining: "1040800000",
    });
    expect(loaded?.doc.data.payments).toMatchObject([
      { method: "bank_transfer", amount: "260200000", pendingCheque: false },
    ]);
    expect(loaded?.doc.data.buyers).toEqual([
      {
        name: "Bensalem Karim",
        nameAr: "بن سالم كريم",
        nin: "109870123456789012",
        birthDate: "1985-04-12",
        birthPlace: "Kouba",
      },
    ]);

    // Later payments never change an issued certificate.
    await pay("1 000 000");
    const again = await withTenant(team.owner, (tx) => loadCertificateDocument(tx, versements.id));
    expect(again?.doc.data.totals.paid).toBe("260200000");

    const list = await listSaleCertificates(accountant, saleId);
    expect(list.map((c) => [c.kind, c.number, c.addressee])).toEqual([
      ["payments", versements.number, null],
      ["reservation", booking.number, "CNEP Banque, agence de Kouba"],
    ]);
    expect(await listSaleCertificates(team.agentB, saleId)).toEqual([]);

    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "certificate.issue"), eq(auditLog.entityId, saleId))),
    );
    expect(audits).toHaveLength(2);
  });

  it("certifies full payment only once nothing remains and every cheque is cleared", async () => {
    const { saleId, cashier, accountant, pay } = await scenario();
    const { paymentId } = await pay("13 010 000", "cheque");
    await expect(issue(accountant, saleId, "paid_in_full")).rejects.toMatchObject({
      messageKey: "certificates.errors.chequePending",
    });
    await clearCheque(cashier, clearChequeSchema.parse({ paymentId, clearedOn: today }));
    const done = await issue(accountant, saleId, "paid_in_full");
    expect(done.number).toMatch(/^ATT-/);
  });

  it("renders the bilingual PDF once, filed under the sale", async () => {
    const { team, saleId, accountant, pay } = await scenario();
    await pay("2 602 000");
    const { id } = await issue(accountant, saleId, "payments", "CNEP Banque");
    const loaded = await withTenant(team.owner, (tx) => loadCertificateDocument(tx, id));
    if (!loaded) throw new Error("certificate not found");
    const html = certificateHtml(loaded.doc, {
      name: "El Bahdja",
      legalName: "SARL El Bahdja",
      address: null,
      wilaya: "16 - Alger",
      phone: null,
      rcNumber: "16/00-1234567B21",
      nif: null,
      nis: null,
      aiNumber: null,
    });
    expect(html).toContain("ATTESTATION DE VERSEMENTS");
    expect(html).toContain("deux millions six cent deux mille dinars");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("pour servir et valoir ce que de droit");

    expect(await renderAndStoreCertificate(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreCertificate(team.orgId, id)).toBe("skipped");
    const [row] = await withTenant(team.owner, (tx) =>
      tx
        .select({ entityType: file.entityType, entityId: file.entityId, name: file.fileName })
        .from(certificate)
        .innerJoin(file, eq(file.id, certificate.pdfFileId))
        .where(eq(certificate.id, id)),
    );
    expect(row).toEqual({
      entityType: "reservation",
      entityId: saleId,
      name: `${loaded.doc.number}.pdf`,
    });
  });

  it("lets the buyer draw its statement from the portal, once a day while nothing changes", async () => {
    const { team, buyerId, saleId, pay } = await scenario();
    const member = await addMember(team.orgId, ["resident"]);
    await withTenant(team.manager, (tx) =>
      tx.insert(portalLink).values({
        organizationId: team.orgId,
        email: `client-${randomUUID().slice(0, 8)}@example.test`,
        userId: member.userId,
        buyerId,
        createdBy: team.manager.userId,
      }),
    );
    const portal: PortalCtx = {
      userId: member.userId,
      orgId: team.orgId,
      name: "Karim Bensalem",
      locale: "fr",
    };
    const first = await issuePortalStatement(portal, { reservationId: saleId });
    expect(first.reused).toBe(false);
    const second = await issuePortalStatement(portal, { reservationId: saleId });
    expect(second).toMatchObject({ id: first.id, reused: true });
    await pay("100 000");
    const third = await issuePortalStatement(portal, { reservationId: saleId });
    expect(third.reused).toBe(false);

    const sale = await getPortalSale(portal, saleId);
    expect(sale?.certificates.map((c) => c.kind)).toEqual(["statement", "statement"]);

    // Another account's sale stays out of reach.
    const stranger = await addMember(team.orgId, ["resident"]);
    await expect(
      issuePortalStatement(
        { userId: stranger.userId, orgId: team.orgId, name: "X", locale: "fr" },
        { reservationId: saleId },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
