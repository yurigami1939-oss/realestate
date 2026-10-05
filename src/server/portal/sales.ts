import "server-only";

import { and, asc, desc, eq, exists, inArray, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  bankLoan,
  buyer,
  building,
  constructionMilestone,
  installment,
  payment,
  paymentCall,
  project,
  receipt,
  reminderLetter,
  reservation,
  reservationBuyer,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { computeStatement } from "@/lib/statement";
import { loadMilestones } from "@/server/payment-plans/queries";
import { paidTotals } from "@/server/sales/sale-queries";

import { type PortalCtx, portalScope } from "./context";

/** Penalties are a staff tool (CLAUDE.md §7): the portal shows the schedule without them. */
const NO_PENALTIES = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

/** Live sales (reserved or sold) that one of these buyer files takes part in. */
export function portalSales(tx: Tx, buyerIds: string[]) {
  return and(
    inArray(reservation.status, ["reserved", "sold"]),
    exists(
      tx
        .select({ id: reservationBuyer.buyerId })
        .from(reservationBuyer)
        .where(
          and(
            eq(reservationBuyer.reservationId, reservation.id),
            inArray(reservationBuyer.buyerId, buyerIds),
          ),
        ),
    ),
  );
}

/** Whether a sale is shown to the portal account (its PDFs then are too). */
export async function isPortalSale(tx: Tx, userId: string, reservationId: string) {
  const { buyerIds } = await portalScope(tx, { userId });
  if (buyerIds.length === 0) return false;
  const [row] = await tx
    .select({ id: reservation.id })
    .from(reservation)
    .where(and(eq(reservation.id, reservationId), portalSales(tx, buyerIds)));
  return row !== undefined;
}

/**
 * A sale of the portal account, as its buyer sees it (CLAUDE.md §12): the unit, schedule and
 * statement (no penalties), payments with their receipts, documents (sheet, signed scans,
 * payment calls, reminder letters), the project's construction progress and the bank loan.
 * Null when the sale is not one of the account's.
 */
export async function getPortalSale(ctx: PortalCtx, saleId: string) {
  if (!isUuid(saleId)) return null;
  return withTenant(ctx, async (tx) => {
    const { buyerIds } = await portalScope(tx, ctx);
    if (buyerIds.length === 0) return null;
    const [row] = await tx
      .select({
        id: reservation.id,
        number: reservation.number,
        status: reservation.status,
        reservedOn: reservation.reservedOn,
        price: reservation.price,
        saleNumber: reservation.saleNumber,
        saleSignedOn: reservation.saleSignedOn,
        sheetFileId: reservation.sheetFileId,
        contractFileId: reservation.reservationScanFileId,
        deedFileId: reservation.saleScanFileId,
        projectId: reservation.projectId,
        unitCode: unit.code,
        unitFloor: unit.floor,
        unitType: unit.type,
        unitTypology: unit.typology,
        livingArea: unit.livingArea,
        usableArea: unit.usableArea,
        buildingName: building.name,
        projectName: project.name,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .where(and(eq(reservation.id, saleId), portalSales(tx, buyerIds)));
    if (!row) return null;

    const buyers = await tx
      .select({ lastName: buyer.lastName, firstName: buyer.firstName })
      .from(reservationBuyer)
      .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
      .where(eq(reservationBuyer.reservationId, row.id))
      .orderBy(asc(reservationBuyer.position));
    const installments = await tx
      .select({
        position: installment.position,
        label: installment.label,
        amount: installment.amount,
        dueOn: installment.dueOn,
        milestoneName: constructionMilestone.name,
      })
      .from(installment)
      .leftJoin(constructionMilestone, eq(constructionMilestone.id, installment.milestoneId))
      .where(eq(installment.reservationId, row.id))
      .orderBy(asc(installment.position));
    const paid = (await paidTotals(tx, [row.id])).get(row.id) ?? 0n;
    const statement = computeStatement(installments, paid, todayInAlgiers(), NO_PENALTIES);
    const payments = await tx
      .select({
        id: payment.id,
        paidOn: payment.paidOn,
        method: payment.method,
        amount: payment.amount,
        status: payment.status,
        chequeClearedOn: payment.chequeClearedOn,
        receiptNumber: receipt.number,
        receiptPdfFileId: receipt.pdfFileId,
      })
      .from(payment)
      .innerJoin(receipt, eq(receipt.paymentId, payment.id))
      .where(eq(payment.reservationId, row.id))
      .orderBy(desc(payment.paidOn), desc(payment.createdAt));
    const calls = await tx
      .select({
        id: paymentCall.id,
        number: paymentCall.number,
        label: paymentCall.label,
        called: paymentCall.called,
        dueOn: paymentCall.dueOn,
        pdfFileId: paymentCall.pdfFileId,
      })
      .from(paymentCall)
      .where(eq(paymentCall.reservationId, row.id))
      .orderBy(asc(paymentCall.issuedAt), asc(paymentCall.number));
    const reminders = await tx
      .select({
        id: reminderLetter.id,
        issuedAt: reminderLetter.issuedAt,
        payBy: reminderLetter.payBy,
        overdue: reminderLetter.overdue,
        pdfFileId: reminderLetter.pdfFileId,
      })
      .from(reminderLetter)
      .where(eq(reminderLetter.reservationId, row.id))
      .orderBy(desc(reminderLetter.issuedAt));
    const loans = await tx
      .select({
        id: bankLoan.id,
        bank: bankLoan.bank,
        status: bankLoan.status,
        requested: bankLoan.requested,
        approved: bankLoan.approved,
        submittedOn: bankLoan.submittedOn,
        decidedOn: bankLoan.decidedOn,
      })
      .from(bankLoan)
      .where(eq(bankLoan.reservationId, row.id))
      .orderBy(sql`${bankLoan.status} in ('refused', 'cancelled')`, desc(bankLoan.createdAt));
    return {
      ...row,
      buyers,
      statement,
      payments,
      calls,
      reminders,
      milestones: await loadMilestones(tx, row.projectId),
      loans,
    };
  });
}

export type PortalSale = NonNullable<Awaited<ReturnType<typeof getPortalSale>>>;
