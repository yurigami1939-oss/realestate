import "server-only";

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Tx } from "@/db/client";
import {
  building,
  buyer,
  commission,
  constructionMilestone,
  file,
  handover,
  installment,
  paymentPlan,
  project,
  reservation,
  reservationBuyer,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { deliveryDelayDays, deliveryPenalty, warrantyEnds } from "@/lib/obligations";
import { checkVspLimits } from "@/lib/payment-plans";
import { computeStatement } from "@/lib/statement";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleBuyers } from "@/server/buyers/access";
import { loadSalesSettings } from "@/server/organizations/settings";

import { visibleSales } from "./access";
import { countMissingDocuments } from "./reservations";
import { SALES_PAGE_SIZE, type SaleListParams } from "./schemas";

const commercial = alias(user, "commercial");
const sheetFile = alias(file, "sheet_file");
const scanFile = alias(file, "scan_file");
const deedFile = alias(file, "deed_file");
const guaranteeFile = alias(file, "guarantee_file");

/**
 * Total of the valid payments of each reservation (module 3 payments). Until payments exist,
 * a reservation has paid nothing.
 */
export async function paidTotals(tx: Tx, reservationIds: string[]): Promise<Map<string, bigint>> {
  const totals = new Map<string, bigint>();
  if (reservationIds.length === 0) return totals;
  const rows = await tx.execute<{ reservation_id: string; paid: string }>(sql`
    select reservation_id, coalesce(sum(amount), 0)::text as paid
    from payment
    where status = 'valid' and reservation_id in (${sql.join(
      reservationIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    group by reservation_id`);
  for (const row of rows.rows) totals.set(row.reservation_id, BigInt(row.paid));
  return totals;
}

/** Buyers of reservations, main first: "Kaci Amina & Kaci Rachid". */
export async function buyerNames(tx: Tx, reservationIds: string[]) {
  if (reservationIds.length === 0) return new Map<string, string>();
  const rows = await tx
    .select({
      reservationId: reservationBuyer.reservationId,
      lastName: buyer.lastName,
      firstName: buyer.firstName,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(inArray(reservationBuyer.reservationId, reservationIds))
    .orderBy(asc(reservationBuyer.position));
  const names = new Map<string, string>();
  for (const r of rows) {
    const name = `${r.lastName} ${r.firstName}`;
    const previous = names.get(r.reservationId);
    names.set(r.reservationId, previous ? `${previous} & ${name}` : name);
  }
  return names;
}

export function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  return or(
    ilike(reservation.number, like),
    ilike(unit.code, like),
    sql`exists (
      select 1 from reservation_buyer rb join buyer b on b.id = rb.buyer_id
      where rb.reservation_id = ${reservation.id}
        and (b.last_name ilike ${like} or b.first_name ilike ${like})
    )`,
  );
}

/** One page of sales (reservations and VSP), most recent first, with amounts paid. */
export async function listSales(ctx: TenantCtx, params: SaleListParams) {
  assertCan(ctx, "sale:read");
  const page = params.page ?? 1;
  return withTenant(ctx, async (tx) => {
    const where = and(
      visibleSales(ctx),
      params.status ? eq(reservation.status, params.status) : undefined,
      searchCondition(params.q),
    );
    const rows = await tx
      .select({
        id: reservation.id,
        number: reservation.number,
        status: reservation.status,
        reservedOn: reservation.reservedOn,
        saleSignedOn: reservation.saleSignedOn,
        price: reservation.price,
        unitCode: unit.code,
        projectName: project.name,
        commercialName: commercial.name,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .leftJoin(commercial, eq(commercial.id, reservation.commercialUserId))
      .where(where)
      .orderBy(desc(reservation.reservedOn), desc(reservation.number))
      .limit(SALES_PAGE_SIZE)
      .offset((page - 1) * SALES_PAGE_SIZE);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .where(where);
    const ids = rows.map((r) => r.id);
    const [paid, names] = [await paidTotals(tx, ids), await buyerNames(tx, ids)];
    return {
      rows: rows.map((r) => ({
        ...r,
        buyers: names.get(r.id) ?? "—",
        paid: paid.get(r.id) ?? 0n,
      })),
      total: total?.n ?? 0,
      page,
      pageSize: SALES_PAGE_SIZE,
    };
  });
}

export type SaleListRow = Awaited<ReturnType<typeof listSales>>["rows"][number];

/** Everything about one sale; `ctx` limits it to visible sales (omit for jobs). */
export async function loadSale(tx: Tx, orgId: string, reservationId: string, ctx?: TenantCtx) {
  const [row] = await tx
    .select({
      reservation,
      unitCode: unit.code,
      unitFloor: unit.floor,
      unitType: unit.type,
      unitTypology: unit.typology,
      unitLivingArea: unit.livingArea,
      unitUsableArea: unit.usableArea,
      buildingName: building.name,
      projectName: project.name,
      projectAddress: project.address,
      projectCommune: project.commune,
      projectWilaya: project.wilaya,
      planName: paymentPlan.name,
      commercialName: commercial.name,
      sheetFileName: sheetFile.fileName,
      scanFileName: scanFile.fileName,
      deedFileName: deedFile.fileName,
      guaranteeFileName: guaranteeFile.fileName,
    })
    .from(reservation)
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .leftJoin(paymentPlan, eq(paymentPlan.id, reservation.paymentPlanId))
    .leftJoin(commercial, eq(commercial.id, reservation.commercialUserId))
    .leftJoin(sheetFile, eq(sheetFile.id, reservation.sheetFileId))
    .leftJoin(scanFile, eq(scanFile.id, reservation.reservationScanFileId))
    .leftJoin(deedFile, eq(deedFile.id, reservation.saleScanFileId))
    .leftJoin(guaranteeFile, eq(guaranteeFile.id, reservation.guaranteeScanFileId))
    .where(and(eq(reservation.id, reservationId), ctx ? visibleSales(ctx) : undefined));
  if (!row) return null;

  const buyers = await tx
    .select({
      id: buyer.id,
      position: reservationBuyer.position,
      civility: buyer.civility,
      lastName: buyer.lastName,
      firstName: buyer.firstName,
      lastNameAr: buyer.lastNameAr,
      firstNameAr: buyer.firstNameAr,
      birthDate: buyer.birthDate,
      birthPlace: buyer.birthPlace,
      nin: buyer.nin,
      phone: buyer.phone,
      address: buyer.address,
      commune: buyer.commune,
      wilaya: buyer.wilaya,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, reservationId))
    .orderBy(asc(reservationBuyer.position));

  const installments = await tx
    .select({
      position: installment.position,
      label: installment.label,
      shareBp: installment.shareBp,
      amount: installment.amount,
      trigger: installment.trigger,
      months: installment.months,
      milestoneId: installment.milestoneId,
      dueOn: installment.dueOn,
      milestoneName: constructionMilestone.name,
      milestoneStage: constructionMilestone.stage,
      milestonePlannedOn: constructionMilestone.plannedOn,
      milestoneValidatedOn: constructionMilestone.validatedOn,
    })
    .from(installment)
    .leftJoin(constructionMilestone, eq(constructionMilestone.id, installment.milestoneId))
    .where(eq(installment.reservationId, reservationId))
    .orderBy(asc(installment.position));

  const [earned] = await tx
    .select()
    .from(commission)
    .where(eq(commission.reservationId, reservationId));
  const settings = await loadSalesSettings(tx, orgId);
  // Loi 11-04: delivery against the contractual date, warranties from the handover PV.
  const [delivered] = await tx
    .select({ signedOn: handover.signedOn })
    .from(handover)
    .where(and(eq(handover.reservationId, reservationId), eq(handover.status, "signed")));
  const deliveredOn = delivered?.signedOn ?? null;
  const daysLate =
    row.reservation.status === "withdrawn"
      ? 0
      : deliveryDelayDays({
          dueOn: row.reservation.deliveryDueOn,
          deliveredOn,
          today: todayInAlgiers(),
        });
  const paid = (await paidTotals(tx, [reservationId])).get(reservationId) ?? 0n;
  const statement = computeStatement(installments, paid, todayInAlgiers(), {
    monthlyRateBp: settings.penaltyMonthlyRateBp,
    graceDays: settings.penaltyGraceDays,
    capBp: settings.penaltyCapBp,
  });
  const { reservation: r, ...rest } = row;
  return {
    ...r,
    ...rest,
    buyers,
    installments,
    statement,
    commission: earned ?? null,
    obligations: {
      deliveredOn,
      daysLate,
      penalty: deliveryPenalty(row.reservation.price, daysLate, {
        monthlyRateBp: settings.deliveryPenaltyMonthlyRateBp,
        capBp: settings.deliveryPenaltyCapBp,
      }),
      warranties: deliveredOn ? warrantyEnds(deliveredOn) : null,
    },
    missingDocuments: await countMissingDocuments(
      tx,
      buyers.map((b) => b.id),
    ),
    vspWarnings: checkVspLimits(
      installments,
      installments.flatMap((i) =>
        i.milestoneId ? [{ id: i.milestoneId, stage: i.milestoneStage }] : [],
      ),
      settings.vspLimits,
    ),
  };
}

export type SaleDetail = NonNullable<Awaited<ReturnType<typeof loadSale>>>;

/** Sale page: details, buyers, installments and statement, for a visible sale. */
export async function getSale(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return null;
  return withTenant(ctx, (tx) => loadSale(tx, ctx.orgId, reservationId, ctx));
}

/** Sales of a buyer (buyer sheet). */
export async function listBuyerSales(ctx: TenantCtx, buyerId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(buyerId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: reservation.id,
        number: reservation.number,
        status: reservation.status,
        unitCode: unit.code,
        projectName: project.name,
        price: reservation.price,
        reservedOn: reservation.reservedOn,
      })
      .from(reservationBuyer)
      .innerJoin(reservation, eq(reservation.id, reservationBuyer.reservationId))
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
      .where(
        and(
          eq(reservationBuyer.buyerId, buyerId),
          isNull(buyer.deletedAt),
          visibleBuyers(ctx),
          visibleSales(ctx),
        ),
      )
      .orderBy(desc(reservation.reservedOn)),
  );
}

/** The live sale of a unit, if any (unit sheet link). */
export async function getUnitSale(ctx: TenantCtx, unitId: string) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(unitId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: reservation.id, number: reservation.number, status: reservation.status })
      .from(reservation)
      .where(
        and(
          eq(reservation.unitId, unitId),
          inArray(reservation.status, ["reserved", "sold"]),
          visibleSales(ctx),
        ),
      );
    return row ?? null;
  });
}
