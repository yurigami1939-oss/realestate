import "server-only";

import { and, asc, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";

import {
  building,
  lease,
  managementMandate,
  ownerStatement,
  project,
  propertyOwner,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { ownerStatementTotals } from "@/lib/mandates";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { recordAccess } from "@/server/privacy/consents";

import { pendingStatementPayments } from "./statements";

/**
 * Owners whose units the organization lets (`lease:read`), by name: their active mandates and
 * what their unpaid statements owe them.
 */
export async function listOwners(ctx: TenantCtx) {
  assertCan(ctx, "lease:read");
  return withTenant(ctx, async (tx) => {
    // Correlated subqueries in the select list: the outer column is written by hand (§10).
    const owners = await tx
      .select({
        id: propertyOwner.id,
        name: propertyOwner.name,
        phone: propertyOwner.phone,
        mandates: sql<number>`(select count(*)::int from ${managementMandate}
          where ${managementMandate.ownerId} = property_owner.id
            and ${managementMandate.status} = 'active')`,
        unpaid: sql<string>`(select coalesce(sum(${ownerStatement.net}), 0)::text
          from ${ownerStatement}
          where ${ownerStatement.ownerId} = property_owner.id
            and ${ownerStatement.status} = 'issued')`,
      })
      .from(propertyOwner)
      .where(isNull(propertyOwner.deletedAt))
      .orderBy(asc(propertyOwner.name));
    return owners.map((o) => ({ ...o, unpaid: BigInt(o.unpaid) }));
  });
}

export type OwnerRow = Awaited<ReturnType<typeof listOwners>>[number];

/**
 * An owner's page (`lease:read`): identity and bank details, its mandates with their unit and
 * active lease, its statements (latest first) and what the next one would report today.
 */
export async function getOwner(ctx: TenantCtx, ownerId: string) {
  assertCan(ctx, "lease:read");
  if (!isUuid(ownerId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [owner] = await tx
      .select()
      .from(propertyOwner)
      .where(and(eq(propertyOwner.id, ownerId), isNull(propertyOwner.deletedAt)));
    if (!owner) return null;
    await recordAccess(tx, ctx, "owner", owner.id);
    const mandates = await tx
      .select({
        id: managementMandate.id,
        unitId: unit.id,
        unitCode: unit.code,
        projectId: project.id,
        projectName: project.name,
        signedOn: managementMandate.signedOn,
        startOn: managementMandate.startOn,
        feeRateBp: managementMandate.feeRateBp,
        status: managementMandate.status,
        endedOn: managementMandate.endedOn,
        endReason: managementMandate.endReason,
      })
      .from(managementMandate)
      .innerJoin(unit, eq(unit.id, managementMandate.unitId))
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(eq(managementMandate.ownerId, owner.id))
      .orderBy(asc(managementMandate.status), asc(unit.code));
    const leases =
      mandates.length === 0
        ? []
        : await tx
            .select({
              id: lease.id,
              number: lease.number,
              mandateId: lease.mandateId,
              tenantName: lease.tenantName,
              status: lease.status,
              startOn: lease.startOn,
              endOn: lease.endOn,
              monthlyRent: lease.monthlyRent,
            })
            .from(lease)
            .where(
              inArray(
                lease.mandateId,
                mandates.map((m) => m.id),
              ),
            )
            .orderBy(desc(lease.startOn));
    const statements = await tx
      .select({
        id: ownerStatement.id,
        number: ownerStatement.number,
        periodFrom: ownerStatement.periodFrom,
        periodTo: ownerStatement.periodTo,
        issuedOn: ownerStatement.issuedOn,
        collected: ownerStatement.collected,
        fees: ownerStatement.fees,
        deductions: ownerStatement.deductions,
        net: ownerStatement.net,
        status: ownerStatement.status,
        paidOn: ownerStatement.paidOn,
        paymentMethod: ownerStatement.paymentMethod,
        cancellationReason: ownerStatement.cancellationReason,
        pdfFileId: ownerStatement.pdfFileId,
      })
      .from(ownerStatement)
      .where(eq(ownerStatement.ownerId, owner.id))
      .orderBy(desc(ownerStatement.createdAt));
    const pending = ownerStatementTotals(await pendingStatementPayments(tx, owner.id, today), []);
    return {
      ...owner,
      mandates: mandates.map((m) => ({
        ...m,
        lease: leases.find((l) => l.mandateId === m.id && l.status === "active") ?? null,
      })),
      leases,
      statements,
      pending,
    };
  });
}

export type OwnerDetail = NonNullable<Awaited<ReturnType<typeof getOwner>>>;

/**
 * Units an owner may entrust to the organization (`lease:update`): delivered to their buyer or
 * in a third party's building, and under no active mandate.
 */
export async function listMandatableUnits(ctx: TenantCtx) {
  assertCan(ctx, "lease:update");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: unit.id,
        code: unit.code,
        projectName: project.name,
        buildingName: building.name,
      })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .where(
        and(
          eq(unit.status, "delivered"),
          isNull(unit.deletedAt),
          isNull(project.deletedAt),
          notExists(
            tx
              .select({ id: managementMandate.id })
              .from(managementMandate)
              .where(
                and(eq(managementMandate.unitId, unit.id), eq(managementMandate.status, "active")),
              ),
          ),
        ),
      )
      .orderBy(asc(project.name), asc(unit.code)),
  );
}
