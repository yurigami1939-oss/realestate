import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  installment,
  reservation,
  reservationBuyer,
  reservationTransfer,
  unit,
  unitOption,
  unitSwap,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { allocate } from "@/lib/money";
import { netPrice } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleBuyer } from "@/server/buyers/access";
import { discardFile } from "@/server/files/service";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { saleAnnexes } from "@/server/sales/annexes";

import { loadVisibleReservation } from "./access";
import { paidTotals } from "./sale-queries";
import type { swapUnitSchema, transferReservationSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

function assertNotFuture(date: CalendarDate, field: string) {
  if (date > todayInAlgiers()) throw invalid(field, "sales.errors.futureDate");
}

/** The reservation sheet describes buyers and unit: after a change, a new one is rendered. */
async function renewSheet(
  tx: Tx,
  ctx: TenantCtx,
  sale: { id: string; sheetFileId: string | null },
) {
  if (sale.sheetFileId) {
    await tx.update(reservation).set({ sheetFileId: null }).where(eq(reservation.id, sale.id));
    await discardFile(tx, sale.sheetFileId);
  }
  await enqueueInTx(
    tx,
    "pdf.document",
    { organizationId: ctx.orgId, kind: "reservation_sheet", id: sale.id },
    { singletonKey: `reservation_sheet:${sale.id}` },
  );
}

/**
 * Cession de réservation (CLAUDE.md §7): new buyers take the reservation over; the unit stays
 * reserved and the payments stay with the sale. Before the VSP only.
 */
export async function transferReservation(
  ctx: TenantCtx,
  input: In<typeof transferReservationSchema>,
) {
  assertCan(ctx, "sale:update");
  assertNotFuture(input.transferredOn, "transferredOn");
  await withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status !== "reserved") throw new AppError("CONFLICT", "sales.errors.notReserved");
    if (input.transferredOn < sale.reservedOn) {
      throw invalid("transferredOn", "sales.errors.beforeReservation");
    }
    for (const buyerId of input.buyerIds) await loadVisibleBuyer(tx, ctx, buyerId);
    const current = (
      await tx
        .select({ buyerId: reservationBuyer.buyerId })
        .from(reservationBuyer)
        .where(eq(reservationBuyer.reservationId, sale.id))
        .orderBy(asc(reservationBuyer.position))
    ).map((b) => b.buyerId);
    if (current.join() === input.buyerIds.join()) {
      throw invalid("buyerIds", "sales.transfer.errors.sameBuyers");
    }

    await tx.delete(reservationBuyer).where(eq(reservationBuyer.reservationId, sale.id));
    await tx.insert(reservationBuyer).values(
      input.buyerIds.map((buyerId, index) => ({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        buyerId,
        position: index + 1,
      })),
    );
    await tx.insert(reservationTransfer).values({
      organizationId: ctx.orgId,
      reservationId: sale.id,
      transferredOn: input.transferredOn,
      fromBuyerIds: current,
      toBuyerIds: input.buyerIds,
      notes: input.notes,
      recordedBy: ctx.userId,
    });
    await renewSheet(tx, ctx, sale);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "reservation.transfer",
      entityType: "reservation",
      entityId: sale.id,
      before: { buyers: current },
      after: { buyers: input.buyerIds, transferredOn: input.transferredOn },
      reason: input.notes ?? undefined,
    });
  });
}

/**
 * Changement de lot (CLAUDE.md §7): the sale moves to another unit of the project, at that
 * unit's list price (less a manager's discount). In one transaction the old unit is released
 * and the new one reserved; installments keep their shares and dates, with amounts split
 * again on the new price. What is already paid must not exceed it.
 */
export async function swapUnit(ctx: TenantCtx, input: In<typeof swapUnitSchema>) {
  assertCan(ctx, "sale:update");
  if (input.discount > 0n && !can(ctx.roles, "sale:discount")) {
    throw new AppError("FORBIDDEN", "quotations.errors.discountForbidden");
  }
  assertNotFuture(input.swappedOn, "swappedOn");
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status !== "reserved") throw new AppError("CONFLICT", "sales.errors.notReserved");
    if (input.swappedOn < sale.reservedOn) {
      throw invalid("swappedOn", "sales.errors.beforeReservation");
    }
    if (input.unitId === sale.unitId) throw invalid("unitId", "sales.swap.errors.sameUnit");

    const [target] = await tx
      .select({
        code: unit.code,
        status: unit.status,
        projectId: unit.projectId,
        listPrice: unit.listPrice,
      })
      .from(unit)
      .where(eq(unit.id, input.unitId))
      .for("update");
    if (!target) throw new AppError("NOT_FOUND");
    if (target.projectId !== sale.projectId) {
      throw invalid("unitId", "sales.swap.errors.otherProject");
    }
    const [option] =
      target.status === "optioned"
        ? await tx
            .select()
            .from(unitOption)
            .where(and(eq(unitOption.unitId, input.unitId), eq(unitOption.status, "active")))
            .for("update")
        : [];
    if (target.status === "optioned") {
      if (!option || option.leadId !== sale.leadId) {
        throw new AppError("CONFLICT", "sales.errors.optionedForAnother");
      }
    } else if (target.status !== "available") {
      throw new AppError("CONFLICT", "sales.errors.unitNotAvailable");
    }
    if (target.listPrice === null) {
      throw new AppError("CONFLICT", "quotations.errors.unitNotPriced");
    }
    // The sale's annexes stay with it: their list prices add to the new unit's.
    const annexes = (await saleAnnexes(tx, [sale.id])).get(sale.id) ?? [];
    const listPrice = annexes.reduce((sum, a) => sum + a.listPrice, target.listPrice);
    if (input.discount > listPrice) {
      throw invalid("discount", "quotations.errors.discountTooHigh");
    }
    const price = netPrice(listPrice, input.discount);
    const paid = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    if (paid > price) throw new AppError("CONFLICT", "sales.swap.errors.paidAbovePrice");

    const lines = await tx
      .select({ position: installment.position, shareBp: installment.shareBp })
      .from(installment)
      .where(eq(installment.reservationId, sale.id))
      .orderBy(asc(installment.position));
    const amounts = allocate(
      price,
      lines.map((l) => BigInt(l.shareBp)),
    );
    for (const [index, line] of lines.entries()) {
      await tx
        .update(installment)
        .set({ amount: amounts[index] ?? 0n })
        .where(
          and(eq(installment.reservationId, sale.id), eq(installment.position, line.position)),
        );
    }

    if (option) {
      await tx
        .update(unitOption)
        .set({ status: "converted", endedAt: new Date(), endedBy: ctx.userId })
        .where(eq(unitOption.id, option.id));
    }
    await transitionUnit(tx, ctx, sale.unitId, "available", {
      reason: input.reason,
      refType: "reservation",
      refId: sale.id,
    });
    await transitionUnit(tx, ctx, input.unitId, "reserved", {
      reason: input.reason,
      refType: "reservation",
      refId: sale.id,
    });
    await tx
      .update(reservation)
      .set({
        unitId: input.unitId,
        listPrice,
        discount: input.discount,
        price,
      })
      .where(eq(reservation.id, sale.id));
    await tx.insert(unitSwap).values({
      organizationId: ctx.orgId,
      reservationId: sale.id,
      fromUnitId: sale.unitId,
      toUnitId: input.unitId,
      fromPrice: sale.price,
      toPrice: price,
      swappedOn: input.swappedOn,
      reason: input.reason,
      recordedBy: ctx.userId,
    });
    await renewSheet(tx, ctx, sale);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "reservation.swap_unit",
      entityType: "reservation",
      entityId: sale.id,
      before: {
        unitId: sale.unitId,
        listPrice: sale.listPrice,
        discount: sale.discount,
        price: sale.price,
      },
      after: {
        unitId: input.unitId,
        unit: target.code,
        listPrice: target.listPrice,
        discount: input.discount,
        price,
      },
      reason: input.reason,
    });
    return { price };
  });
}
