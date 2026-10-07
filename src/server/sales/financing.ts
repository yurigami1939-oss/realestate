import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { payment, saleFinancing } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import type { Centimes } from "@/lib/money";
import { AppError } from "@/lib/result";
import { type FinancingSource, financingSources, paymentSource } from "@/lib/sales";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { loadVisibleReservation } from "./access";
import type { saveSaleFinancingSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/**
 * Saves the financing plan of a sale as a whole (`sale:finance`; gérant, directeur commercial,
 * the commercial of the sale): one line per source with what it is expected to bring, never
 * more in total than the price. A live sale only; audited `reservation.financing`.
 */
export async function saveSaleFinancing(ctx: TenantCtx, input: In<typeof saveSaleFinancingSchema>) {
  assertCan(ctx, "sale:finance");
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const total = input.lines.reduce((sum, l) => sum + l.expected, 0n);
    if (total > sale.price) {
      throw new AppError("VALIDATION", "sales.financing.errors.abovePrice", {
        fieldErrors: { lines: ["sales.financing.errors.abovePrice"] },
      });
    }
    const before = await tx
      .select({
        source: saleFinancing.source,
        expected: saleFinancing.expected,
        reference: saleFinancing.reference,
      })
      .from(saleFinancing)
      .where(eq(saleFinancing.reservationId, sale.id));
    await tx.delete(saleFinancing).where(eq(saleFinancing.reservationId, sale.id));
    if (input.lines.length > 0) {
      await tx.insert(saleFinancing).values(
        input.lines.map((line) => ({
          organizationId: ctx.orgId,
          reservationId: sale.id,
          source: line.source,
          expected: line.expected,
          reference: line.reference,
          createdBy: ctx.userId,
        })),
      );
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "reservation.financing",
      entityType: "reservation",
      entityId: sale.id,
      before: { lines: before },
      after: { lines: input.lines },
    });
    return { total };
  });
}

/**
 * The financing plan of a visible sale with what each source has brought so far: valid payments
 * counted by their recorded source, else by their method (`paymentSource`). Sources that brought
 * money without being planned are listed too (expected 0). `unplanned`: the price less the plan.
 */
export async function getSaleFinancing(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return null;
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, reservationId);
    const planned = await tx
      .select({
        source: saleFinancing.source,
        expected: saleFinancing.expected,
        reference: saleFinancing.reference,
      })
      .from(saleFinancing)
      .where(eq(saleFinancing.reservationId, sale.id))
      .orderBy(asc(saleFinancing.source));
    const paid = await tx
      .select({
        method: payment.method,
        source: payment.financingSource,
        total: sql<string>`sum(${payment.amount})::text`,
      })
      .from(payment)
      .where(and(eq(payment.reservationId, sale.id), eq(payment.status, "valid")))
      .groupBy(payment.method, payment.financingSource);
    const received = new Map<FinancingSource, Centimes>();
    for (const row of paid) {
      const source = paymentSource(row.method, row.source);
      received.set(source, (received.get(source) ?? 0n) + BigInt(row.total));
    }
    const lines = financingSources.flatMap((source) => {
      const plan = planned.find((p) => p.source === source);
      const got = received.get(source) ?? 0n;
      if (!plan && got === 0n) return [];
      return [
        {
          source,
          expected: plan?.expected ?? 0n,
          reference: plan?.reference ?? null,
          received: got,
          planned: plan !== undefined,
        },
      ];
    });
    const plannedTotal = planned.reduce((sum, p) => sum + p.expected, 0n);
    return {
      lines,
      plannedTotal,
      unplanned: sale.price - plannedTotal,
      hasPlan: planned.length > 0,
    };
  });
}

export type SaleFinancing = NonNullable<Awaited<ReturnType<typeof getSaleFinancing>>>;
