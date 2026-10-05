import "server-only";

import { and, asc, eq, gt, inArray, isNull, max, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { handover, project, punchItem, reservation, residenceUnit, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import type { PrintedReserve } from "@/lib/handovers";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { addSaleBuyersAsCoOwners, hasCurrentCoOwner } from "@/server/residences/service";
import { paidTotals } from "@/server/sales/sale-queries";
import { notifyHandoverAppointment } from "@/server/whatsapp/notify";

import type {
  addPunchItemSchema,
  cancelPunchItemSchema,
  closeReservesSchema,
  liftPunchItemSchema,
  pastDeliveriesSchema,
  requestHandoverDocumentSchema,
  scheduleHandoverSchema,
  signHandoverSchema,
  updatePunchItemSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

function assertNotFuture(day: string, field: string) {
  if (day > todayInAlgiers()) throw invalid(field, "handovers.errors.futureDate");
}

/** A handover of the organization (locked); NOT_FOUND otherwise. */
async function loadHandover(tx: Tx, handoverId: string) {
  const [row] = await tx.select().from(handover).where(eq(handover.id, handoverId)).for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** A reserve with its handover, both locked; NOT_FOUND otherwise. */
async function loadPunchItem(tx: Tx, punchItemId: string) {
  const [item] = await tx
    .select()
    .from(punchItem)
    .where(eq(punchItem.id, punchItemId))
    .for("update");
  if (!item) throw new AppError("NOT_FOUND");
  return { item, handover: await loadHandover(tx, item.handoverId) };
}

/** Reserves can no longer change once the PV de levée closed them. */
function assertReservesOpen(row: { reservesClosedOn: string | null }) {
  if (row.reservesClosedOn) throw new AppError("CONFLICT", "handovers.errors.reservesClosed");
}

/** An open reserve that the signed PV did not print can still be edited or deleted. */
function assertEditable(
  item: { status: string; position: number },
  row: { status: string; reserves: PrintedReserve[] | null },
) {
  if (item.status !== "open") throw new AppError("CONFLICT", "handovers.errors.reserveSettled");
  if (row.status === "signed" && row.reserves?.some((r) => r.position === item.position)) {
    throw new AppError("CONFLICT", "handovers.errors.onPv");
  }
}

/**
 * Plans (or moves) the handover appointment of a sold unit (VSP signed). The first scheduling
 * creates the handover; a signed one no longer moves.
 */
export async function scheduleHandover(ctx: TenantCtx, input: In<typeof scheduleHandoverSchema>) {
  assertCan(ctx, "handover:update");
  return withTenant(ctx, async (tx) => {
    const [sale] = await tx
      .select({ id: reservation.id, status: reservation.status, unitId: reservation.unitId })
      .from(reservation)
      .where(eq(reservation.id, input.reservationId))
      .for("update");
    if (!sale) throw new AppError("NOT_FOUND");
    if (sale.status !== "sold") throw new AppError("CONFLICT", "handovers.errors.notSold");
    const [existing] = await tx
      .select({ id: handover.id, status: handover.status, scheduledAt: handover.scheduledAt })
      .from(handover)
      .where(eq(handover.reservationId, sale.id))
      .for("update");
    if (existing) {
      if (existing.status === "signed") throw new AppError("CONFLICT", "handovers.errors.signed");
      await tx
        .update(handover)
        .set({ scheduledAt: input.scheduledAt, notes: input.notes })
        .where(eq(handover.id, existing.id));
      if (existing.scheduledAt?.getTime() !== input.scheduledAt.getTime()) {
        await notifyHandoverAppointment(tx, ctx, sale.id, input.scheduledAt);
      }
      return { id: existing.id };
    }
    const [row] = await tx
      .insert(handover)
      .values({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        unitId: sale.unitId,
        scheduledAt: input.scheduledAt,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: handover.id });
    if (!row) throw new Error("scheduleHandover: no row returned");
    await notifyHandoverAppointment(tx, ctx, sale.id, input.scheduledAt);
    return { id: row.id };
  });
}

/** A reserve found at the visit (or after the handover, until the reserves are closed). */
export async function addPunchItem(ctx: TenantCtx, input: In<typeof addPunchItemSchema>) {
  assertCan(ctx, "handover:update");
  const { handoverId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const row = await loadHandover(tx, handoverId);
    assertReservesOpen(row);
    const [last] = await tx
      .select({ position: max(punchItem.position) })
      .from(punchItem)
      .where(eq(punchItem.handoverId, row.id));
    const [item] = await tx
      .insert(punchItem)
      .values({
        ...fields,
        organizationId: ctx.orgId,
        handoverId: row.id,
        position: (last?.position ?? 0) + 1,
        createdBy: ctx.userId,
      })
      .returning({ id: punchItem.id });
    if (!item) throw new Error("addPunchItem: no row returned");
    return { id: item.id };
  });
}

export async function updatePunchItem(ctx: TenantCtx, input: In<typeof updatePunchItemSchema>) {
  assertCan(ctx, "handover:update");
  const { punchItemId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const { item, handover: row } = await loadPunchItem(tx, punchItemId);
    assertReservesOpen(row);
    assertEditable(item, row);
    await tx.update(punchItem).set(fields).where(eq(punchItem.id, item.id));
  });
}

/** Deletes a reserve recorded by mistake (never one printed on the PV: cancel it instead). */
export async function deletePunchItem(ctx: TenantCtx, punchItemId: string) {
  assertCan(ctx, "handover:update");
  await withTenant(ctx, async (tx) => {
    const { item, handover: row } = await loadPunchItem(tx, punchItemId);
    assertReservesOpen(row);
    assertEditable(item, row);
    await tx.delete(punchItem).where(eq(punchItem.id, item.id));
    // The next ones move up: reserves printed on a PV always come before those added later.
    await tx
      .update(punchItem)
      .set({ position: sql`${punchItem.position} - 1` })
      .where(and(eq(punchItem.handoverId, row.id), gt(punchItem.position, item.position)));
  });
}

/** Records that a reserve's works are done (before the handover, it is then not printed). */
export async function liftPunchItem(ctx: TenantCtx, input: In<typeof liftPunchItemSchema>) {
  assertCan(ctx, "handover:update");
  assertNotFuture(input.liftedOn, "liftedOn");
  await withTenant(ctx, async (tx) => {
    const { item, handover: row } = await loadPunchItem(tx, input.punchItemId);
    assertReservesOpen(row);
    if (item.status !== "open") throw new AppError("CONFLICT", "handovers.errors.reserveSettled");
    await tx
      .update(punchItem)
      .set({
        status: "lifted",
        liftedOn: input.liftedOn,
        liftNote: input.note,
        liftedBy: ctx.userId,
      })
      .where(eq(punchItem.id, item.id));
  });
}

/** Cancels a reserve (recorded by mistake, not accepted as a defect), with the reason. */
export async function cancelPunchItem(ctx: TenantCtx, input: In<typeof cancelPunchItemSchema>) {
  assertCan(ctx, "handover:update");
  await withTenant(ctx, async (tx) => {
    const { item, handover: row } = await loadPunchItem(tx, input.punchItemId);
    assertReservesOpen(row);
    if (item.status !== "open") throw new AppError("CONFLICT", "handovers.errors.reserveSettled");
    await tx
      .update(punchItem)
      .set({ status: "cancelled", cancelReason: input.reason, cancelledBy: ctx.userId })
      .where(eq(punchItem.id, item.id));
  });
}

/**
 * Signs the PV de remise des clés (CLAUDE.md §7), final: numbered PVL-…, the reserves still
 * open printed as they are, what remains to pay on the sale noted, the unit `delivered`, and,
 * when the unit is in a residence without a current co-owner, the buyers become its co-owners
 * from that day. Audited; the bilingual PV is rendered by the worker.
 */
export async function signHandover(ctx: TenantCtx, input: In<typeof signHandoverSchema>) {
  assertCan(ctx, "handover:update");
  assertNotFuture(input.signedOn, "signedOn");
  const { handoverId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const row = await loadHandover(tx, handoverId);
    if (row.status === "signed") throw new AppError("CONFLICT", "handovers.errors.signed");
    const [sale] = await tx
      .select({
        id: reservation.id,
        status: reservation.status,
        unitId: reservation.unitId,
        price: reservation.price,
        saleSignedOn: reservation.saleSignedOn,
      })
      .from(reservation)
      .where(eq(reservation.id, row.reservationId))
      .for("update");
    if (!sale || sale.status !== "sold") throw new AppError("CONFLICT", "handovers.errors.notSold");
    if (sale.saleSignedOn && input.signedOn < sale.saleSignedOn) {
      throw invalid("signedOn", "handovers.errors.beforeSale");
    }

    const paid = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    const outstanding = sale.price > paid ? sale.price - paid : 0n;
    const reserves: PrintedReserve[] = await tx
      .select({
        position: punchItem.position,
        location: punchItem.location,
        description: punchItem.description,
        trade: punchItem.trade,
      })
      .from(punchItem)
      .where(and(eq(punchItem.handoverId, row.id), eq(punchItem.status, "open")))
      .orderBy(asc(punchItem.position));
    const { number } = await nextDocumentNumber(tx, ctx, "handover");
    await tx
      .update(handover)
      .set({
        ...fields,
        status: "signed",
        number,
        outstanding,
        reserves,
        signedBy: ctx.userId,
      })
      .where(eq(handover.id, row.id));
    await transitionUnit(tx, ctx, sale.unitId, "delivered", {
      refType: "handover",
      refId: row.id,
    });

    // The new owners join the residence the unit belongs to, if any.
    let coOwners = 0;
    const [member] = await tx
      .select({ residenceId: residenceUnit.residenceId })
      .from(residenceUnit)
      .where(eq(residenceUnit.unitId, sale.unitId));
    if (member && !(await hasCurrentCoOwner(tx, sale.unitId, input.signedOn))) {
      coOwners = await addSaleBuyersAsCoOwners(tx, ctx, {
        residenceId: member.residenceId,
        unitId: sale.unitId,
        saleId: sale.id,
        sinceOn: input.signedOn,
      });
    }

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "handover.sign",
      entityType: "handover",
      entityId: row.id,
      before: { status: "scheduled" },
      after: {
        status: "signed",
        number,
        signedOn: input.signedOn,
        receivedBy: input.receivedBy,
        keysCount: input.keysCount,
        outstanding,
        reserves: reserves.length,
        coOwners,
      },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "handover_pv", id: row.id },
      { singletonKey: `handover_pv:${row.id}` },
    );
    return { number, outstanding, reserves: reserves.length, coOwners };
  });
}

/**
 * Closes the reserves of a signed handover once none is open (at least one lifted): the PV de
 * levée des réserves, dated from the last lifting on, is rendered by the worker. Audited.
 */
export async function closeReserves(ctx: TenantCtx, input: In<typeof closeReservesSchema>) {
  assertCan(ctx, "handover:update");
  assertNotFuture(input.closedOn, "closedOn");
  await withTenant(ctx, async (tx) => {
    const row = await loadHandover(tx, input.handoverId);
    if (row.status !== "signed") throw new AppError("CONFLICT", "handovers.errors.notSigned");
    assertReservesOpen(row);
    const items = await tx
      .select({ status: punchItem.status, liftedOn: punchItem.liftedOn })
      .from(punchItem)
      .where(eq(punchItem.handoverId, row.id));
    if (items.some((i) => i.status === "open")) {
      throw new AppError("CONFLICT", "handovers.errors.openReserves");
    }
    const lifted = items.flatMap((i) => (i.status === "lifted" && i.liftedOn ? [i.liftedOn] : []));
    if (lifted.length === 0) throw new AppError("CONFLICT", "handovers.errors.noReserves");
    const lastLifted = lifted.reduce((a, b) => (a > b ? a : b));
    const signedOn = row.signedOn ?? "";
    if (input.closedOn < signedOn || input.closedOn < lastLifted) {
      throw invalid("closedOn", "handovers.errors.beforeLifting");
    }
    await tx
      .update(handover)
      .set({ reservesClosedOn: input.closedOn })
      .where(eq(handover.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "handover.close_reserves",
      entityType: "handover",
      entityId: row.id,
      after: { number: row.number, closedOn: input.closedOn, lifted: lifted.length },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "handover_release", id: row.id },
      { singletonKey: `handover_release:${row.id}` },
    );
  });
}

/**
 * Units sold and handed over before the app (CLAUDE.md §12): in a delivered project, units
 * still `available` or `blocked` (never sold through the app) become `delivered`, with the
 * reason in their status history.
 */
export async function recordPastDeliveries(ctx: TenantCtx, input: In<typeof pastDeliveriesSchema>) {
  assertCan(ctx, "handover:update");
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({ status: project.status })
      .from(project)
      .where(and(eq(project.id, input.projectId), isNull(project.deletedAt)));
    if (!target) throw new AppError("NOT_FOUND");
    if (target.status !== "delivered") {
      throw new AppError("CONFLICT", "handovers.errors.projectNotDelivered");
    }
    const ids = [...new Set(input.unitIds)];
    const units = await tx
      .select({ id: unit.id, code: unit.code, status: unit.status })
      .from(unit)
      .where(
        and(eq(unit.projectId, input.projectId), inArray(unit.id, ids), isNull(unit.deletedAt)),
      )
      .orderBy(asc(unit.code));
    if (units.length !== ids.length) throw invalid("unitIds", "handovers.errors.noUnit");
    const engaged = units.find((u) => u.status !== "available" && u.status !== "blocked");
    if (engaged) {
      throw new AppError("CONFLICT", "handovers.errors.unitEngaged", {
        details: { unit: engaged.code },
      });
    }
    for (const u of units) {
      await transitionUnit(tx, ctx, u.id, "delivered", {
        reason: input.reason,
        refType: "project",
        refId: input.projectId,
      });
    }
    return { delivered: units.length };
  });
}

/** Requests a delivery PDF again when it is still missing (idempotent job). */
export async function requestHandoverDocument(
  ctx: TenantCtx,
  input: In<typeof requestHandoverDocumentSchema>,
) {
  assertCan(ctx, "handover:read");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        status: handover.status,
        pdfFileId: handover.pdfFileId,
        reservesClosedOn: handover.reservesClosedOn,
        releaseFileId: handover.releaseFileId,
      })
      .from(handover)
      .where(eq(handover.id, input.handoverId));
    if (!row) throw new AppError("NOT_FOUND");
    const issued =
      input.kind === "handover_pv" ? row.status === "signed" : row.reservesClosedOn !== null;
    const stored = input.kind === "handover_pv" ? row.pdfFileId : row.releaseFileId;
    if (!issued || stored) return;
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: input.kind, id: input.handoverId },
      { singletonKey: `${input.kind}:${input.handoverId}` },
    );
  });
}
