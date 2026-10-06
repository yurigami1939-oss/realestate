import "server-only";

import { and, asc, desc, eq, exists, inArray, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  bankLoan,
  buyer,
  building,
  certificate,
  constructionMilestone,
  constructionReport,
  handover,
  installment,
  payment,
  paymentCall,
  project,
  punchItem,
  receipt,
  reminderLetter,
  scheduleAmendment,
  reservation,
  reservationBuyer,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { computeStatement } from "@/lib/statement";
import { latestProgress, loadReports } from "@/server/construction/queries";
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

/** Whether a site photo's report is published for a project the portal account bought in. */
export async function isPortalReport(tx: Tx, userId: string, reportId: string) {
  const { buyerIds } = await portalScope(tx, { userId });
  if (buyerIds.length === 0) return false;
  const [row] = await tx
    .select({ id: constructionReport.id })
    .from(constructionReport)
    .where(
      and(
        eq(constructionReport.id, reportId),
        isNull(constructionReport.deletedAt),
        eq(constructionReport.published, true),
        exists(
          tx
            .select({ id: reservation.id })
            .from(reservation)
            .where(
              and(
                eq(reservation.projectId, constructionReport.projectId),
                portalSales(tx, buyerIds),
              ),
            ),
        ),
      ),
    );
  return row !== undefined;
}

/** Published construction reports shown to buyers on their sale's page. */
const PORTAL_REPORTS = 10;

/**
 * A sale of the portal account, as its buyer sees it (CLAUDE.md §12): the unit, schedule and
 * statement (no penalties), payments with their receipts, documents (sheet, signed scans,
 * payment calls, reminder letters, certificates), the project's construction progress (milestones, its
 * building's progress and the published reports with their photos), the handover (appointment,
 * PVs, reserves) and the bank loan.
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
        deliveryDueOn: reservation.deliveryDueOn,
        sheetFileId: reservation.sheetFileId,
        contractFileId: reservation.reservationScanFileId,
        deedFileId: reservation.saleScanFileId,
        projectId: reservation.projectId,
        buildingId: unit.buildingId,
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
        legacyReceipt: payment.legacyReceipt,
      })
      .from(payment)
      .leftJoin(receipt, eq(receipt.paymentId, payment.id))
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
        kind: reminderLetter.kind,
        issuedAt: reminderLetter.issuedAt,
        payBy: reminderLetter.payBy,
        overdue: reminderLetter.overdue,
        pdfFileId: reminderLetter.pdfFileId,
      })
      .from(reminderLetter)
      .where(eq(reminderLetter.reservationId, row.id))
      .orderBy(desc(reminderLetter.issuedAt));
    const amendments = await tx
      .select({
        id: scheduleAmendment.id,
        sequence: scheduleAmendment.sequence,
        signedOn: scheduleAmendment.signedOn,
        pdfFileId: scheduleAmendment.pdfFileId,
      })
      .from(scheduleAmendment)
      .where(eq(scheduleAmendment.reservationId, row.id))
      .orderBy(desc(scheduleAmendment.sequence));
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
    const [delivery] = await tx
      .select({
        id: handover.id,
        status: handover.status,
        scheduledAt: handover.scheduledAt,
        number: handover.number,
        signedOn: handover.signedOn,
        pdfFileId: handover.pdfFileId,
        reservesClosedOn: handover.reservesClosedOn,
        releaseFileId: handover.releaseFileId,
      })
      .from(handover)
      .where(eq(handover.reservationId, row.id));
    const reserves = delivery
      ? await tx
          .select({
            position: punchItem.position,
            location: punchItem.location,
            description: punchItem.description,
            status: punchItem.status,
            liftedOn: punchItem.liftedOn,
          })
          .from(punchItem)
          .where(eq(punchItem.handoverId, delivery.id))
          .orderBy(asc(punchItem.position))
      : [];
    const certificates = await tx
      .select({
        id: certificate.id,
        kind: certificate.kind,
        number: certificate.number,
        issuedAt: certificate.issuedAt,
        fromPortal: certificate.fromPortal,
        pdfFileId: certificate.pdfFileId,
      })
      .from(certificate)
      .where(eq(certificate.reservationId, row.id))
      .orderBy(desc(certificate.issuedAt));
    return {
      ...row,
      buyers,
      statement,
      payments,
      calls,
      reminders,
      amendments,
      certificates,
      milestones: await loadMilestones(tx, row.projectId),
      progress:
        (await latestProgress(tx, [row.projectId], { publishedOnly: true })).get(row.buildingId) ??
        null,
      reports: await loadReports(tx, row.projectId, {
        publishedOnly: true,
        limit: PORTAL_REPORTS,
      }),
      handover: delivery ? { ...delivery, reserves } : null,
      loans,
    };
  });
}

export type PortalSale = NonNullable<Awaited<ReturnType<typeof getPortalSale>>>;
