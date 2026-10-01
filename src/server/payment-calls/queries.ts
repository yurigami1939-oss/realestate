import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { constructionMilestone, paymentCall, reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleSales } from "@/server/sales/access";

/** Payment calls of a visible sale, in issue order. */
export async function listSalePaymentCalls(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: paymentCall.id,
        number: paymentCall.number,
        label: paymentCall.label,
        milestoneName: constructionMilestone.name,
        called: paymentCall.called,
        dueOn: paymentCall.dueOn,
        issuedAt: paymentCall.issuedAt,
        pdfFileId: paymentCall.pdfFileId,
      })
      .from(paymentCall)
      .innerJoin(reservation, eq(reservation.id, paymentCall.reservationId))
      .innerJoin(constructionMilestone, eq(constructionMilestone.id, paymentCall.milestoneId))
      .where(and(eq(paymentCall.reservationId, reservationId), visibleSales(ctx)))
      .orderBy(asc(paymentCall.issuedAt), asc(paymentCall.number)),
  );
}

export type SalePaymentCallRow = Awaited<ReturnType<typeof listSalePaymentCalls>>[number];
