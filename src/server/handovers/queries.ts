import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  building,
  buyer,
  constructionMilestone,
  handover,
  project,
  punchItem,
  reservation,
  reservationBuyer,
  resident,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { type DeliveryState, deliveryState, deliveryStates } from "@/lib/handovers";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { currentResident } from "@/server/residences/service";
import { buyerNames, paidTotals } from "@/server/sales/sale-queries";

/**
 * Projects whose units can be handed over: delivered, or with their handover-stage milestone
 * validated (CLAUDE.md §12).
 */
async function readyProjects(tx: Tx, projectIds: string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const delivered = await tx
    .select({ id: project.id })
    .from(project)
    .where(and(inArray(project.id, projectIds), eq(project.status, "delivered")));
  const reached = await tx
    .select({ id: constructionMilestone.projectId })
    .from(constructionMilestone)
    .where(
      and(
        inArray(constructionMilestone.projectId, projectIds),
        eq(constructionMilestone.stage, "handover"),
        isNotNull(constructionMilestone.validatedOn),
        isNull(constructionMilestone.deletedAt),
      ),
    );
  return new Set([...delivered, ...reached].map((r) => r.id));
}

/** Open, lifted and late (open past their due day) reserves per handover. */
async function reserveCounts(tx: Tx, handoverIds: string[]) {
  const counts = new Map<string, { open: number; lifted: number; late: number }>();
  if (handoverIds.length === 0) return counts;
  const today = todayInAlgiers();
  const rows = await tx
    .select({
      handoverId: punchItem.handoverId,
      open: sql<number>`count(*) filter (where ${punchItem.status} = 'open')::int`,
      lifted: sql<number>`count(*) filter (where ${punchItem.status} = 'lifted')::int`,
      late: sql<number>`count(*) filter (where ${punchItem.status} = 'open' and ${punchItem.dueOn} < ${today}::date)::int`,
    })
    .from(punchItem)
    .where(inArray(punchItem.handoverId, handoverIds))
    .groupBy(punchItem.handoverId);
  for (const { handoverId, ...c } of rows) counts.set(handoverId, c);
  return counts;
}

/** Order of the deliveries list: what needs doing first. */
const stateOrder: Record<DeliveryState, number> = {
  scheduled: 0,
  to_schedule: 1,
  reserves: 2,
  not_ready: 3,
  delivered: 4,
};

/** States shown by default: what is still to be done. */
const activeStates: readonly DeliveryState[] = ["to_schedule", "scheduled", "reserves"];

export type DeliveryFilters = { projectId?: string; state?: DeliveryState | "all" };

/**
 * Deliveries (handover:read): every sold unit (VSP signed) with its handover state, buyers,
 * appointment, reserves and what remains to pay; active ones by default, appointments first.
 */
export async function listDeliveries(ctx: TenantCtx, filters: DeliveryFilters = {}) {
  assertCan(ctx, "handover:read");
  const projectId = filters.projectId && isUuid(filters.projectId) ? filters.projectId : undefined;
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        saleId: reservation.id,
        saleNumber: reservation.number,
        vspNumber: reservation.saleNumber,
        saleSignedOn: reservation.saleSignedOn,
        price: reservation.price,
        unitCode: unit.code,
        buildingName: building.name,
        projectId: project.id,
        projectName: project.name,
        handoverId: handover.id,
        status: handover.status,
        scheduledAt: handover.scheduledAt,
        number: handover.number,
        signedOn: handover.signedOn,
        reservesClosedOn: handover.reservesClosedOn,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .leftJoin(handover, eq(handover.reservationId, reservation.id))
      .where(
        and(
          eq(reservation.status, "sold"),
          projectId ? eq(reservation.projectId, projectId) : undefined,
        ),
      )
      .orderBy(asc(project.name), asc(unit.code));
    const saleIds = rows.map((r) => r.saleId);
    const ready = await readyProjects(tx, [...new Set(rows.map((r) => r.projectId))]);
    const reserves = await reserveCounts(
      tx,
      rows.flatMap((r) => (r.handoverId ? [r.handoverId] : [])),
    );
    const names = await buyerNames(tx, saleIds);
    const paid = await paidTotals(tx, saleIds);
    const projects = await tx
      .selectDistinct({ id: project.id, name: project.name })
      .from(project)
      .innerJoin(reservation, eq(reservation.projectId, project.id))
      .where(eq(reservation.status, "sold"))
      .orderBy(asc(project.name));

    const items = rows.map((r) => {
      const counts = (r.handoverId ? reserves.get(r.handoverId) : undefined) ?? {
        open: 0,
        lifted: 0,
        late: 0,
      };
      const settled = paid.get(r.saleId) ?? 0n;
      return {
        ...r,
        buyers: names.get(r.saleId) ?? "—",
        remaining: r.price > settled ? r.price - settled : 0n,
        openReserves: counts.open,
        lateReserves: counts.late,
        state: deliveryState({
          ready: ready.has(r.projectId),
          status: r.status,
          openReserves: counts.open,
          liftedReserves: counts.lifted,
          reservesClosedOn: r.reservesClosedOn,
        }),
      };
    });
    const counts = Object.fromEntries(
      deliveryStates.map((s) => [s, items.filter((i) => i.state === s).length]),
    ) as Record<DeliveryState, number>;
    const shown = items
      .filter((i) =>
        filters.state === "all"
          ? true
          : filters.state
            ? i.state === filters.state
            : activeStates.includes(i.state),
      )
      .sort(
        (a, b) =>
          stateOrder[a.state] - stateOrder[b.state] ||
          (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0),
      );
    return { items: shown, counts, projects };
  });
}

export type DeliveryRow = Awaited<ReturnType<typeof listDeliveries>>["items"][number];

/**
 * The delivery of one sold unit (handover:read): the sale (unit, buyers, VSP, what remains to
 * pay), its handover if any and its reserves. Null unless the sale is sold.
 */
export async function getDelivery(ctx: TenantCtx, saleId: string) {
  assertCan(ctx, "handover:read");
  if (!isUuid(saleId)) return null;
  return withTenant(ctx, async (tx) => {
    const [sale] = await tx
      .select({
        id: reservation.id,
        number: reservation.number,
        saleNumber: reservation.saleNumber,
        saleSignedOn: reservation.saleSignedOn,
        price: reservation.price,
        unitId: unit.id,
        unitCode: unit.code,
        unitStatus: unit.status,
        unitTypology: unit.typology,
        buildingName: building.name,
        projectId: project.id,
        projectName: project.name,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .where(and(eq(reservation.id, saleId), eq(reservation.status, "sold")));
    if (!sale) return null;
    const buyers = await tx
      .select({
        id: buyer.id,
        lastName: buyer.lastName,
        firstName: buyer.firstName,
        phone: buyer.phone,
      })
      .from(reservationBuyer)
      .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
      .where(eq(reservationBuyer.reservationId, sale.id))
      .orderBy(asc(reservationBuyer.position));
    const paid = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    const [row] = await tx.select().from(handover).where(eq(handover.reservationId, sale.id));
    const items = row
      ? await tx
          .select()
          .from(punchItem)
          .where(eq(punchItem.handoverId, row.id))
          .orderBy(asc(punchItem.position))
      : [];
    const ready = (await readyProjects(tx, [sale.projectId])).has(sale.projectId);
    return {
      ...sale,
      buyers,
      paid,
      remaining: sale.price > paid ? sale.price - paid : 0n,
      ready,
      handover: row ?? null,
      items,
      state: deliveryState({
        ready,
        status: row?.status ?? null,
        openReserves: items.filter((i) => i.status === "open").length,
        liftedReserves: items.filter((i) => i.status === "lifted").length,
        reservesClosedOn: row?.reservesClosedOn ?? null,
      }),
    };
  });
}

export type Delivery = NonNullable<Awaited<ReturnType<typeof getDelivery>>>;

/**
 * Units of a delivered project that can be marked delivered before the app (still available
 * or blocked), with their current main co-owner when the project has a residence.
 */
export async function listPastDeliveryUnits(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "handover:read");
  if (!isUuid(projectId)) return [];
  return withTenant(ctx, async (tx) => {
    const units = await tx
      .select({ id: unit.id, code: unit.code, status: unit.status })
      .from(unit)
      .where(
        and(
          eq(unit.projectId, projectId),
          inArray(unit.status, ["available", "blocked"]),
          isNull(unit.deletedAt),
        ),
      )
      .orderBy(asc(unit.code));
    if (units.length === 0) return [];
    const owners = await tx
      .select({
        unitId: resident.unitId,
        lastName: resident.lastName,
        firstName: resident.firstName,
      })
      .from(resident)
      .where(
        and(
          inArray(
            resident.unitId,
            units.map((u) => u.id),
          ),
          eq(resident.kind, "co_owner"),
          eq(resident.isMain, true),
          currentResident(todayInAlgiers()),
        ),
      );
    return units.map((u) => {
      const owner = owners.find((o) => o.unitId === u.id);
      return { ...u, coOwner: owner ? `${owner.lastName} ${owner.firstName}` : null };
    });
  });
}

export type PastDeliveryUnit = Awaited<ReturnType<typeof listPastDeliveryUnits>>[number];
