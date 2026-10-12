import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  installment,
  onlinePayment,
  paymentGateway,
  project,
  reservation,
  residence,
  resident,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { computeStatement } from "@/lib/statement";
import { paidTotals } from "@/server/sales/sale-queries";

import { type PortalCtx, portalScope } from "./context";
import { portalLeases } from "./leases";
import { portalSales } from "./sales";

/** The portal home: the account's purchases (live sales of its buyer files) and its units. */
export async function getPortalOverview(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const scope = await portalScope(tx, ctx);
    const sales =
      scope.buyerIds.length === 0
        ? []
        : await tx
            .select({
              id: reservation.id,
              number: reservation.number,
              status: reservation.status,
              reservedOn: reservation.reservedOn,
              unitCode: unit.code,
              projectName: project.name,
            })
            .from(reservation)
            .innerJoin(unit, eq(unit.id, reservation.unitId))
            .innerJoin(project, eq(project.id, reservation.projectId))
            .where(portalSales(tx, scope.buyerIds))
            .orderBy(desc(reservation.reservedOn));
    const units =
      scope.residents.length === 0
        ? []
        : await tx
            .select({
              residentId: resident.id,
              kind: resident.kind,
              councilMember: resident.councilMember,
              unitId: unit.id,
              unitCode: unit.code,
              residenceId: residence.id,
              residenceName: residence.name,
            })
            .from(resident)
            .innerJoin(unit, eq(unit.id, resident.unitId))
            .innerJoin(residence, eq(residence.id, resident.residenceId))
            .where(
              inArray(
                resident.id,
                scope.residents.map((r) => r.id),
              ),
            )
            .orderBy(asc(residence.name), asc(unit.code));
    // Each sale's balance and next installment, as its portal page counts them (no penalties).
    const paid = await paidTotals(
      tx,
      sales.map((s) => s.id),
    );
    const today = todayInAlgiers();
    const withBalance = [];
    for (const sale of sales) {
      const installments = await tx
        .select({
          position: installment.position,
          label: installment.label,
          amount: installment.amount,
          dueOn: installment.dueOn,
        })
        .from(installment)
        .where(eq(installment.reservationId, sale.id))
        .orderBy(asc(installment.position));
      const statement = computeStatement(installments, paid.get(sale.id) ?? 0n, today, {
        monthlyRateBp: 0,
        graceDays: 0,
        capBp: 0,
      });
      const next = statement.lines.find((line) => line.remaining > 0n && line.dueOn !== null);
      withBalance.push({
        ...sale,
        price: statement.price,
        paid: statement.paid,
        remaining: statement.remaining,
        overdue: statement.overdue,
        next: next ? { amount: next.remaining, dueOn: next.dueOn } : null,
      });
    }
    const leases = await portalLeases(tx, scope);
    return { sales: withBalance, units, leases };
  });
}

export type PortalOverview = Awaited<ReturnType<typeof getPortalOverview>>;

/**
 * Which portal sections the account has: residence ones for residents, assemblies for
 * co-owners, online payments when the organization offers them or the account has paid online.
 */
export async function getPortalSections(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const { buyerIds, residents } = await portalScope(tx, ctx);
    const coOwner = residents.some((r) => r.kind === "co_owner");
    const [tenant] = await portalLeases(tx, { buyerIds, residents });
    const [gateway] = await tx
      .select({
        sale: paymentGateway.salesEnabled,
        charges: paymentGateway.chargesEnabled,
        rent: paymentGateway.rentEnabled,
      })
      .from(paymentGateway)
      .where(and(eq(paymentGateway.organizationId, ctx.orgId), eq(paymentGateway.enabled, true)));
    const [paid] = await tx
      .select({ id: onlinePayment.id })
      .from(onlinePayment)
      .where(eq(onlinePayment.userId, ctx.userId))
      .limit(1);
    return {
      buyer: buyerIds.length > 0,
      residences: residents.length > 0,
      coOwner,
      payments:
        paid !== undefined ||
        (gateway !== undefined &&
          ((gateway.sale && buyerIds.length > 0) ||
            (gateway.charges && coOwner) ||
            (gateway.rent && tenant !== undefined))),
    };
  });
}
