import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  building,
  file,
  lease,
  project,
  rentPayment,
  residence,
  resident,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { leaseState } from "@/lib/rentals";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { leasePaid, rentStatement } from "./accounts";

export type LeaseFilters = { status?: "active" | "ended" | "all"; projectId?: string };

/**
 * Leases (lease:read) with their unit, tenant, terms, state and what is overdue; the active
 * ones by default, the closest term first.
 */
export async function listLeases(ctx: TenantCtx, filters: LeaseFilters = {}) {
  assertCan(ctx, "lease:read");
  const status = filters.status ?? "active";
  const projectId = filters.projectId && isUuid(filters.projectId) ? filters.projectId : undefined;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: lease.id,
        number: lease.number,
        status: lease.status,
        kind: lease.kind,
        tenantName: lease.tenantName,
        signedOn: lease.signedOn,
        startOn: lease.startOn,
        durationMonths: lease.durationMonths,
        endOn: lease.endOn,
        endedOn: lease.endedOn,
        monthlyRent: lease.monthlyRent,
        monthlyCharges: lease.monthlyCharges,
        frequency: lease.frequency,
        unitId: unit.id,
        unitCode: unit.code,
        projectId: project.id,
        projectName: project.name,
      })
      .from(lease)
      .innerJoin(unit, eq(unit.id, lease.unitId))
      .innerJoin(project, eq(project.id, lease.projectId))
      .where(
        and(
          status === "all" ? undefined : eq(lease.status, status),
          projectId ? eq(lease.projectId, projectId) : undefined,
        ),
      )
      .orderBy(asc(lease.endOn), asc(unit.code));
    const paid = await leasePaid(
      tx,
      rows.map((r) => r.id),
    );
    const projects = await tx
      .selectDistinct({ id: project.id, name: project.name })
      .from(project)
      .innerJoin(lease, eq(lease.projectId, project.id))
      .orderBy(asc(project.name));
    return {
      items: rows.map((r) => {
        const statement = rentStatement(r, paid.get(r.id)?.rent ?? 0n, today);
        return {
          ...r,
          overdue: statement.overdue,
          state: leaseState(r, today),
        };
      }),
      projects,
    };
  });
}

export type LeaseRow = Awaited<ReturnType<typeof listLeases>>["items"][number];

/**
 * A lease with its page (lease:read): unit, tenant, terms, the rent schedule and its statement,
 * the payments with their receipts, the deposit held, the lease it renews and its renewal, the
 * residence the tenant occupies and the contract scan. Null when unknown.
 */
export async function getLease(ctx: TenantCtx, leaseId: string) {
  assertCan(ctx, "lease:read");
  if (!isUuid(leaseId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        lease,
        unitCode: unit.code,
        unitType: unit.type,
        unitTypology: unit.typology,
        livingArea: unit.livingArea,
        usableArea: unit.usableArea,
        buildingName: building.name,
        projectName: project.name,
      })
      .from(lease)
      .innerJoin(unit, eq(unit.id, lease.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .innerJoin(project, eq(project.id, lease.projectId))
      .where(eq(lease.id, leaseId));
    if (!row) return null;
    const l = row.lease;
    const payments = await tx
      .select({
        id: rentPayment.id,
        kind: rentPayment.kind,
        amount: rentPayment.amount,
        method: rentPayment.method,
        paidOn: rentPayment.paidOn,
        reference: rentPayment.reference,
        bank: rentPayment.bank,
        payerName: rentPayment.payerName,
        chequeClearedOn: rentPayment.chequeClearedOn,
        receiptNumber: rentPayment.receiptNumber,
        allocation: rentPayment.allocation,
        status: rentPayment.status,
        cancellationReason: rentPayment.cancellationReason,
        pdfFileId: rentPayment.pdfFileId,
        recordedBy: user.name,
      })
      .from(rentPayment)
      .innerJoin(user, eq(user.id, rentPayment.recordedBy))
      .where(eq(rentPayment.leaseId, l.id))
      .orderBy(desc(rentPayment.paidOn), desc(rentPayment.createdAt));
    const paid = (await leasePaid(tx, [l.id])).get(l.id) ?? { rent: 0n, deposit: 0n };
    const [renewedFrom] = l.renewedFromId
      ? await tx
          .select({ id: lease.id, number: lease.number })
          .from(lease)
          .where(eq(lease.id, l.renewedFromId))
      : [];
    const [renewal] = await tx
      .select({ id: lease.id, number: lease.number })
      .from(lease)
      .where(eq(lease.renewedFromId, l.id));
    const [occupancy] = l.occupantId
      ? await tx
          .select({ residenceId: residence.id, residenceName: residence.name })
          .from(resident)
          .innerJoin(residence, eq(residence.id, resident.residenceId))
          .where(eq(resident.id, l.occupantId))
      : [];
    const [scan] = l.contractScanFileId
      ? await tx
          .select({ fileName: file.fileName })
          .from(file)
          .where(and(eq(file.id, l.contractScanFileId), isNull(file.deletedAt)))
      : [];
    return {
      ...l,
      unitCode: row.unitCode,
      unitType: row.unitType,
      unitTypology: row.unitTypology,
      area: row.livingArea ?? row.usableArea,
      buildingName: row.buildingName,
      projectName: row.projectName,
      state: leaseState(l, today),
      statement: rentStatement(l, paid.rent, today),
      payments,
      depositHeld: l.depositCarried + paid.deposit,
      renewedFrom: renewedFrom ?? null,
      renewal: renewal ?? null,
      occupancy: occupancy ?? null,
      scanFileName: scan?.fileName ?? null,
    };
  });
}

export type LeaseDetail = NonNullable<Awaited<ReturnType<typeof getLease>>>;

/** Units that can be leased (lease:update): available, or kept by the company (blocked). */
export async function listLeasableUnits(ctx: TenantCtx) {
  assertCan(ctx, "lease:update");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: unit.id,
        code: unit.code,
        type: unit.type,
        typology: unit.typology,
        status: unit.status,
        projectName: project.name,
        buildingName: building.name,
      })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .where(
        and(
          inArray(unit.status, ["available", "blocked"]),
          isNull(unit.deletedAt),
          isNull(project.deletedAt),
        ),
      )
      .orderBy(asc(project.name), asc(unit.code)),
  );
}

export type LeasableUnit = Awaited<ReturnType<typeof listLeasableUnits>>[number];
