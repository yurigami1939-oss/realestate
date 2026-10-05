import "server-only";

import { and, asc, desc, eq, exists, inArray } from "drizzle-orm";

import { project, reservation, reservationBuyer, residence, resident, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import { type PortalCtx, portalScope } from "./context";

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
            .where(
              and(
                inArray(reservation.status, ["reserved", "sold"]),
                exists(
                  tx
                    .select({ id: reservationBuyer.buyerId })
                    .from(reservationBuyer)
                    .where(
                      and(
                        eq(reservationBuyer.reservationId, reservation.id),
                        inArray(reservationBuyer.buyerId, scope.buyerIds),
                      ),
                    ),
                ),
              ),
            )
            .orderBy(desc(reservation.reservedOn));
    const units =
      scope.residents.length === 0
        ? []
        : await tx
            .select({
              residentId: resident.id,
              kind: resident.kind,
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
    return { sales, units };
  });
}

export type PortalOverview = Awaited<ReturnType<typeof getPortalOverview>>;
