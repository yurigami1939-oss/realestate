import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { lease, project, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { registrationDueOn } from "@/lib/rentals";
import { AppError } from "@/lib/result";
import { loadTaxSettings } from "@/server/accounting/tax";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { registerLeaseSchema } from "./schemas";
import { loadLease } from "./service";

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/**
 * Records a lease's registration at the tax office (CLAUDE.md §7 Rentals) — the day (from its
 * signature to today), the office, the reference and the duties paid — or corrects it. The
 * duties are noted, not paid through the app (an expense of the account they left). Audited.
 */
export async function registerLease(ctx: TenantCtx, input: z.output<typeof registerLeaseSchema>) {
  assertCan(ctx, "lease:update");
  if (input.registeredOn > todayInAlgiers()) {
    throw invalid("registeredOn", "rentals.errors.futureDate");
  }
  await withTenant(ctx, async (tx) => {
    const row = await loadLease(tx, input.leaseId);
    if (input.registeredOn < row.signedOn) {
      throw invalid("registeredOn", "rentals.registration.errors.beforeSigning");
    }
    const after = {
      registeredOn: input.registeredOn,
      registrationOffice: input.office,
      registrationReference: input.reference,
      registrationDuty: input.duty,
    };
    await tx.update(lease).set(after).where(eq(lease.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.register",
      entityType: "lease",
      entityId: row.id,
      before: row.registeredOn
        ? {
            registeredOn: row.registeredOn,
            registrationOffice: row.registrationOffice,
            registrationReference: row.registrationReference,
            registrationDuty: row.registrationDuty,
          }
        : null,
      after,
    });
  });
}

/**
 * Active leases not registered yet, the oldest deadline first, with their deadline (the
 * organization's delay after the signature) — the dashboard's to-do for lease managers.
 */
export async function loadUnregisteredLeases(tx: Tx, orgId: string, today: CalendarDate) {
  const { leaseRegistrationDays } = await loadTaxSettings(tx, orgId);
  const rows = await tx
    .select({
      id: lease.id,
      number: lease.number,
      tenantName: lease.tenantName,
      signedOn: lease.signedOn,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(lease)
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(project, eq(project.id, lease.projectId))
    .where(and(eq(lease.status, "active"), isNull(lease.registeredOn)))
    .orderBy(asc(lease.signedOn), asc(lease.number));
  return rows.map((r) => {
    const dueOn = registrationDueOn(r.signedOn, leaseRegistrationDays);
    return { ...r, dueOn, late: dueOn < today };
  });
}

export type UnregisteredLease = Awaited<ReturnType<typeof loadUnregisteredLeases>>[number];
