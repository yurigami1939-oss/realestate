import "server-only";

import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";

import type { Tx } from "@/db/client";

import {
  building,
  file,
  lease,
  leaseInspection,
  leaseRevision,
  project,
  rentPayment,
  residence,
  resident,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { ENDING_SOON_DAYS, leaseState, rentOn } from "@/lib/rentals";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { leasePaid, leaseRevisions, rentStatement } from "./accounts";

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
        tenantPhone: lease.tenantPhone,
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
    const revisions = await leaseRevisions(
      tx,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => {
        const terms = { ...r, revisions: revisions.get(r.id) };
        const statement = rentStatement(terms, paid.get(r.id)?.rent ?? 0n, today);
        return {
          ...r,
          // The rent in force today (after any revision).
          monthlyRent: rentOn(terms, today).monthlyRent,
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
    const revisionRows = await tx
      .select({
        id: leaseRevision.id,
        effectiveOn: leaseRevision.effectiveOn,
        monthlyRent: leaseRevision.monthlyRent,
        monthlyCharges: leaseRevision.monthlyCharges,
        reason: leaseRevision.reason,
        createdAt: leaseRevision.createdAt,
        createdByName: user.name,
      })
      .from(leaseRevision)
      .innerJoin(user, eq(user.id, leaseRevision.createdBy))
      .where(eq(leaseRevision.leaseId, l.id))
      .orderBy(asc(leaseRevision.effectiveOn));
    const revisions = revisionRows.map(({ effectiveOn, monthlyRent, monthlyCharges }) => ({
      effectiveOn,
      monthlyRent,
      monthlyCharges,
    }));
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
    const inspections = await tx
      .select({
        id: leaseInspection.id,
        kind: leaseInspection.kind,
        inspectedOn: leaseInspection.inspectedOn,
        items: leaseInspection.items,
        pdfFileId: leaseInspection.pdfFileId,
      })
      .from(leaseInspection)
      .where(eq(leaseInspection.leaseId, l.id))
      .orderBy(asc(leaseInspection.inspectedOn));
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
      statement: rentStatement({ ...l, revisions }, paid.rent, today),
      revisions: revisionRows,
      inForce: rentOn({ ...l, revisions }, today),
      payments,
      inspections,
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

/**
 * Leases (active or ended) with rent due before today and not paid, most late first: what is
 * overdue, since when, and the tenant's phone.
 */
export async function loadOverdueRents(tx: Tx, today: CalendarDate) {
  const rows = await tx
    .select({
      id: lease.id,
      number: lease.number,
      status: lease.status,
      tenantName: lease.tenantName,
      tenantPhone: lease.tenantPhone,
      startOn: lease.startOn,
      durationMonths: lease.durationMonths,
      frequency: lease.frequency,
      monthlyRent: lease.monthlyRent,
      monthlyCharges: lease.monthlyCharges,
      endedOn: lease.endedOn,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(lease)
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(project, eq(project.id, lease.projectId))
    .where(lte(lease.startOn, today));
  const paid = await leasePaid(
    tx,
    rows.map((r) => r.id),
  );
  const revisions = await leaseRevisions(
    tx,
    rows.map((r) => r.id),
  );
  return rows
    .flatMap((r) => {
      const statement = rentStatement(
        { ...r, revisions: revisions.get(r.id) },
        paid.get(r.id)?.rent ?? 0n,
        today,
      );
      const oldest = statement.lines.find((l) => l.state === "overdue");
      if (statement.overdue === 0n || !oldest) return [];
      return [
        {
          id: r.id,
          number: r.number,
          status: r.status,
          tenantName: r.tenantName,
          tenantPhone: r.tenantPhone,
          unitCode: r.unitCode,
          projectName: r.projectName,
          overdue: statement.overdue,
          oldestDueOn: oldest.dueOn,
          daysLate: oldest.daysLate,
        },
      ];
    })
    .sort((a, b) => b.daysLate - a.daysLate);
}

export type OverdueRent = Awaited<ReturnType<typeof loadOverdueRents>>[number];

/** Overdue rents (lease:read), most late first. */
export async function listOverdueRents(ctx: TenantCtx) {
  assertCan(ctx, "lease:read");
  return withTenant(ctx, (tx) => loadOverdueRents(tx, todayInAlgiers()));
}

/** Active leases whose term ends within `days` days, or is already over (to end or renew). */
export async function loadEndingLeases(tx: Tx, today: CalendarDate, days = ENDING_SOON_DAYS) {
  return tx
    .select({
      id: lease.id,
      number: lease.number,
      tenantName: lease.tenantName,
      endOn: lease.endOn,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(lease)
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(project, eq(project.id, lease.projectId))
    .where(and(eq(lease.status, "active"), lte(lease.endOn, addDays(today, days))))
    .orderBy(asc(lease.endOn));
}

export type EndingLease = Awaited<ReturnType<typeof loadEndingLeases>>[number];

/** The active lease of a unit, for its page (lease:read); null when it is not rented. */
export async function getUnitLease(ctx: TenantCtx, unitId: string) {
  assertCan(ctx, "lease:read");
  if (!isUuid(unitId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: lease.id,
        number: lease.number,
        tenantName: lease.tenantName,
        startOn: lease.startOn,
        endOn: lease.endOn,
      })
      .from(lease)
      .where(and(eq(lease.unitId, unitId), eq(lease.status, "active")));
    return row ?? null;
  });
}
