import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  certificate,
  payment,
  paymentCall,
  receipt,
  reminderLetter,
  reservation,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { loadVisibleReservation } from "./access";
import type { requestSaleDocumentSchema } from "./schemas";

type DocumentRequest = z.output<typeof requestSaleDocumentSchema>;

/** The sale a document belongs to and its current PDF, or null if unknown. */
async function documentOwner(
  tx: Tx,
  { kind, id }: DocumentRequest,
): Promise<{ reservationId: string; pdfFileId: string | null } | null> {
  switch (kind) {
    case "reservation_sheet": {
      const [row] = await tx
        .select({ reservationId: reservation.id, pdfFileId: reservation.sheetFileId })
        .from(reservation)
        .where(eq(reservation.id, id));
      return row ?? null;
    }
    case "receipt": {
      const [row] = await tx
        .select({ reservationId: payment.reservationId, pdfFileId: receipt.pdfFileId })
        .from(receipt)
        .innerJoin(payment, eq(payment.id, receipt.paymentId))
        .where(eq(receipt.id, id));
      return row ?? null;
    }
    case "payment_call": {
      const [row] = await tx
        .select({ reservationId: paymentCall.reservationId, pdfFileId: paymentCall.pdfFileId })
        .from(paymentCall)
        .where(eq(paymentCall.id, id));
      return row ?? null;
    }
    case "reminder_letter": {
      const [row] = await tx
        .select({
          reservationId: reminderLetter.reservationId,
          pdfFileId: reminderLetter.pdfFileId,
        })
        .from(reminderLetter)
        .where(eq(reminderLetter.id, id));
      return row ?? null;
    }
    case "certificate": {
      const [row] = await tx
        .select({ reservationId: certificate.reservationId, pdfFileId: certificate.pdfFileId })
        .from(certificate)
        .where(eq(certificate.id, id));
      return row ?? null;
    }
  }
}

/** Requests a sale document's PDF again when it is still missing (idempotent job). */
export async function requestSaleDocument(ctx: TenantCtx, input: DocumentRequest) {
  assertCan(ctx, "sale:read");
  await withTenant(ctx, async (tx) => {
    const owner = await documentOwner(tx, input);
    if (!owner) throw new AppError("NOT_FOUND");
    await loadVisibleReservation(tx, ctx, owner.reservationId);
    if (owner.pdfFileId) return;
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: input.kind, id: input.id },
      { singletonKey: `${input.kind}:${input.id}` },
    );
  });
}
