import "server-only";

import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { lease, leaseInspection, project, rentPayment, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { rentOn } from "@/lib/rentals";
import { leaseExtras, leasePaid, rentStatement } from "@/server/rentals/accounts";

import { type PortalCtx, type PortalScope, portalScope } from "./context";

/**
 * The leases a portal account is the tenant of: those whose occupant record is one of its
 * current occupant links (CLAUDE.md §7 Rentals). A lease of a unit outside any residence has no
 * occupant record, so it is not on the portal.
 */
export function portalLeaseCondition(scope: PortalScope): SQL {
  const occupantIds = scope.residents.filter((r) => r.kind === "occupant").map((r) => r.id);
  return occupantIds.length === 0 ? sql`false` : inArray(lease.occupantId, occupantIds);
}

/** The account's leases (latest first), optionally one of them. */
export function portalLeases(tx: Tx, scope: PortalScope, leaseId?: string) {
  return tx
    .select({
      id: lease.id,
      number: lease.number,
      status: lease.status,
      startOn: lease.startOn,
      endOn: lease.endOn,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(lease)
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(project, eq(project.id, lease.projectId))
    .where(and(portalLeaseCondition(scope), leaseId ? eq(lease.id, leaseId) : undefined))
    .orderBy(desc(lease.startOn));
}

/** Whether a lease is shown to the portal account (its quittances and reports then are too). */
export async function isPortalLease(tx: Tx, userId: string, leaseId: string) {
  const scope = await portalScope(tx, { userId });
  const [row] = await portalLeases(tx, scope, leaseId);
  return row !== undefined;
}

/**
 * A lease of the portal account: its terms in force, the rent account (no penalties, like the
 * staff's), the valid payments with their quittances, the deposit held and the inspection
 * reports. Null when it is not the account's.
 */
export async function getPortalLease(ctx: PortalCtx, leaseId: string) {
  if (!isUuid(leaseId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const scope = await portalScope(tx, ctx);
    const [shown] = await portalLeases(tx, scope, leaseId);
    if (!shown) return null;
    const [row] = await tx.select().from(lease).where(eq(lease.id, leaseId));
    if (!row) return null;
    const terms = { ...row, ...(await leaseExtras(tx, [row.id]))(row.id) };
    const paid = (await leasePaid(tx, [row.id])).get(row.id) ?? { rent: 0n, deposit: 0n };
    const payments = await tx
      .select({
        id: rentPayment.id,
        kind: rentPayment.kind,
        amount: rentPayment.amount,
        method: rentPayment.method,
        paidOn: rentPayment.paidOn,
        receiptNumber: rentPayment.receiptNumber,
        pdfFileId: rentPayment.pdfFileId,
        chequeClearedOn: rentPayment.chequeClearedOn,
      })
      .from(rentPayment)
      .where(and(eq(rentPayment.leaseId, row.id), eq(rentPayment.status, "valid")))
      .orderBy(desc(rentPayment.paidOn), desc(rentPayment.createdAt));
    const inspections = await tx
      .select({
        id: leaseInspection.id,
        kind: leaseInspection.kind,
        inspectedOn: leaseInspection.inspectedOn,
        pdfFileId: leaseInspection.pdfFileId,
      })
      .from(leaseInspection)
      .where(eq(leaseInspection.leaseId, row.id))
      .orderBy(asc(leaseInspection.inspectedOn));
    return {
      id: row.id,
      number: row.number,
      kind: row.kind,
      status: row.status,
      unitCode: shown.unitCode,
      projectName: shown.projectName,
      startOn: row.startOn,
      endOn: row.endOn,
      endedOn: row.endedOn,
      durationMonths: row.durationMonths,
      frequency: row.frequency,
      deposit: row.deposit,
      depositHeld: row.depositCarried + paid.deposit,
      inForce: rentOn(terms, today),
      statement: rentStatement(terms, paid.rent, today),
      payments,
      inspections,
    };
  });
}

export type PortalLease = NonNullable<Awaited<ReturnType<typeof getPortalLease>>>;
