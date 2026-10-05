import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { payment, receipt, reservation, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleSales } from "@/server/sales/access";

const recorder = alias(user, "recorder");

/**
 * Payments of a sale with their receipts, most recent first; an imported payment has no receipt
 * of ours, only the previous system's number (`legacyReceipt`).
 */
export async function listSalePayments(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: payment.id,
        amount: payment.amount,
        method: payment.method,
        paidOn: payment.paidOn,
        reference: payment.reference,
        bank: payment.bank,
        payerName: payment.payerName,
        chequeClearedOn: payment.chequeClearedOn,
        status: payment.status,
        cancellationReason: payment.cancellationReason,
        imported: payment.imported,
        legacyReceipt: payment.legacyReceipt,
        recordedByName: recorder.name,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
        receiptPdfFileId: receipt.pdfFileId,
      })
      .from(payment)
      .innerJoin(reservation, eq(reservation.id, payment.reservationId))
      .leftJoin(receipt, eq(receipt.paymentId, payment.id))
      .leftJoin(recorder, eq(recorder.id, payment.recordedBy))
      .where(and(eq(payment.reservationId, reservationId), visibleSales(ctx)))
      .orderBy(desc(payment.paidOn), desc(payment.createdAt)),
  );
}

export type SalePaymentRow = Awaited<ReturnType<typeof listSalePayments>>[number];
