import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  buyer,
  chargeCall,
  chargePayment,
  lease,
  organization,
  organizationSetting,
  payment,
  paymentCall,
  project,
  receipt,
  rentPayment,
  reservation,
  reservationBuyer,
  residence,
  resident,
  unit,
} from "@/db/schema";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { currentResident } from "@/server/residences/service";

import { type ClientDocumentKind, clientDocumentEmail } from "./templates";

type Recipient = { email: string | null; name: string };
type StoredPdf = { storageKey: string; fileName: string };

const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim();

/**
 * Queues the e-mail of an issued document, its PDF attached, to each client with an address
 * (once per address) — only when the organization sends documents by e-mail (CLAUDE.md §5
 * Email). Called by the renderer in the transaction that links the stored PDF: the document is
 * rendered once, so it is e-mailed once.
 */
async function queueClientDocument(
  tx: Tx,
  orgId: string,
  input: {
    kind: ClientDocumentKind;
    number: string;
    amount: Centimes;
    dueOn: CalendarDate | null;
    unitCode: string;
    place: string;
    recipients: Recipient[];
    pdf: StoredPdf;
  },
): Promise<number> {
  const [setting] = await tx
    .select({ on: organizationSetting.emailDocuments })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  if (!setting?.on) return 0;
  // `organization` is Better Auth's table (no RLS): filtered on the job's organization.
  const [org] = await tx
    .select({ name: organization.name, legalName: organization.legalName })
    .from(organization)
    .where(eq(organization.id, orgId));
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    const email = recipient.email?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    await enqueueInTx(
      tx,
      "email.send",
      clientDocumentEmail({
        to: email,
        kind: input.kind,
        name: recipient.name,
        organization: org?.legalName ?? org?.name ?? "",
        number: input.number,
        amount: input.amount,
        dueOn: input.dueOn,
        unitCode: input.unitCode,
        place: input.place,
        attachment: { ...input.pdf, contentType: "application/pdf" },
      }),
    );
  }
  return seen.size;
}

/** A sale's buyers (main first) with the unit and project. */
async function saleClients(tx: Tx, saleId: string) {
  const buyers = await tx
    .select({ firstName: buyer.firstName, lastName: buyer.lastName, email: buyer.email })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, saleId))
    .orderBy(asc(reservationBuyer.position));
  const [sale] = await tx
    .select({ unitCode: unit.code, place: project.name })
    .from(reservation)
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .where(eq(reservation.id, saleId));
  return {
    recipients: buyers.map((b) => ({ email: b.email, name: fullName(b) })),
    unitCode: sale?.unitCode ?? "",
    place: sale?.place ?? "",
  };
}

/** A unit of a residence with the co-owner its charges go to (the call's, else the main one). */
async function chargeClients(
  tx: Tx,
  input: { residenceId: string; unitId: string; residentId: string | null },
) {
  const [place] = await tx
    .select({ unitCode: unit.code, place: residence.name })
    .from(residence)
    .innerJoin(unit, eq(unit.id, input.unitId))
    .where(eq(residence.id, input.residenceId));
  const owner = {
    firstName: resident.firstName,
    lastName: resident.lastName,
    email: resident.email,
  };
  const rows = input.residentId
    ? await tx.select(owner).from(resident).where(eq(resident.id, input.residentId))
    : await tx
        .select(owner)
        .from(resident)
        .where(
          and(
            eq(resident.residenceId, input.residenceId),
            eq(resident.unitId, input.unitId),
            eq(resident.kind, "co_owner"),
            currentResident(todayInAlgiers()),
          ),
        )
        .orderBy(desc(resident.isMain), asc(resident.lastName))
        .limit(1);
  return {
    recipients: rows.map((r) => ({ email: r.email, name: fullName(r) })),
    unitCode: place?.unitCode ?? "",
    place: place?.place ?? "",
  };
}

/** Receipt REC- of a sale's payment (not when cancelled before its PDF). */
export async function emailSaleReceipt(tx: Tx, orgId: string, receiptId: string, pdf: StoredPdf) {
  const [row] = await tx
    .select({
      number: receipt.number,
      status: receipt.status,
      amount: payment.amount,
      saleId: payment.reservationId,
    })
    .from(receipt)
    .innerJoin(payment, eq(payment.id, receipt.paymentId))
    .where(eq(receipt.id, receiptId));
  if (!row || row.status !== "issued") return 0;
  return queueClientDocument(tx, orgId, {
    kind: "receipt",
    number: row.number,
    amount: row.amount,
    dueOn: null,
    ...(await saleClients(tx, row.saleId)),
    pdf,
  });
}

/** Appel de fonds ADF-: what is called now, by its due day. */
export async function emailPaymentCall(tx: Tx, orgId: string, callId: string, pdf: StoredPdf) {
  const [row] = await tx
    .select({
      number: paymentCall.number,
      called: paymentCall.called,
      dueOn: paymentCall.dueOn,
      saleId: paymentCall.reservationId,
    })
    .from(paymentCall)
    .where(eq(paymentCall.id, callId));
  if (!row) return 0;
  return queueClientDocument(tx, orgId, {
    kind: "payment_call",
    number: row.number,
    amount: row.called,
    dueOn: row.dueOn,
    ...(await saleClients(tx, row.saleId)),
    pdf,
  });
}

/** Appel de charges ADC-, to the co-owner it is addressed to (none: a unit the company owns). */
export async function emailChargeCall(tx: Tx, orgId: string, callId: string, pdf: StoredPdf) {
  const [row] = await tx
    .select({
      number: chargeCall.number,
      amount: chargeCall.amount,
      dueOn: chargeCall.dueOn,
      residenceId: chargeCall.residenceId,
      unitId: chargeCall.unitId,
      residentId: chargeCall.residentId,
    })
    .from(chargeCall)
    .where(eq(chargeCall.id, callId));
  if (!row?.residentId) return 0;
  return queueClientDocument(tx, orgId, {
    kind: "charge_call",
    number: row.number,
    amount: row.amount,
    dueOn: row.dueOn,
    ...(await chargeClients(tx, row)),
    pdf,
  });
}

/** Reçu de charges RCH-, to the unit's main co-owner. */
export async function emailChargeReceipt(tx: Tx, orgId: string, paymentId: string, pdf: StoredPdf) {
  const [row] = await tx
    .select({
      number: chargePayment.receiptNumber,
      status: chargePayment.status,
      amount: chargePayment.amount,
      residenceId: chargePayment.residenceId,
      unitId: chargePayment.unitId,
    })
    .from(chargePayment)
    .where(eq(chargePayment.id, paymentId));
  if (!row || row.status !== "valid") return 0;
  return queueClientDocument(tx, orgId, {
    kind: "charge_receipt",
    number: row.number,
    amount: row.amount,
    dueOn: null,
    ...(await chargeClients(tx, { ...row, residentId: null })),
    pdf,
  });
}

/** Quittance de loyer or deposit receipt QIT-, to the tenant. */
export async function emailRentReceipt(tx: Tx, orgId: string, paymentId: string, pdf: StoredPdf) {
  const [row] = await tx
    .select({
      number: rentPayment.receiptNumber,
      kind: rentPayment.kind,
      status: rentPayment.status,
      amount: rentPayment.amount,
      tenantName: lease.tenantName,
      tenantEmail: lease.tenantEmail,
      unitCode: unit.code,
      place: project.name,
    })
    .from(rentPayment)
    .innerJoin(lease, eq(lease.id, rentPayment.leaseId))
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(project, eq(project.id, unit.projectId))
    .where(eq(rentPayment.id, paymentId));
  if (!row || row.status !== "valid") return 0;
  return queueClientDocument(tx, orgId, {
    kind: row.kind === "deposit" ? "deposit_receipt" : "rent_receipt",
    number: row.number,
    amount: row.amount,
    dueOn: null,
    unitCode: row.unitCode,
    place: row.place,
    recipients: [{ email: row.tenantEmail, name: row.tenantName }],
    pdf,
  });
}
