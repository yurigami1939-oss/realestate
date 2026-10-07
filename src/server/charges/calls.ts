import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  budgetLine,
  chargeCall,
  chargeCallLine,
  chargeCategory,
  chargeCategoryUnit,
  chargePeriod,
  residenceUnit,
  resident,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import {
  buildChargeCalls,
  type ChargeCallDraft,
  type ChargeCategory,
  type ChargeUnit,
} from "@/lib/charges";
import { fromAlgiersDateTime, todayInAlgiers } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { callsPerYear } from "@/lib/residences";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { currentResident, loadResidence } from "@/server/residences/service";
import { notifyChargeCall } from "@/server/whatsapp/notify";

import { loadBudget } from "./budgets";
import type { cancelChargePeriodSchema, issueChargePeriodSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Label of the reserve fund line on calls (documents are bilingual). */
export const RESERVE_LABEL = { fr: "Fonds de réserve", ar: "صندوق الاحتياط" };

/** Units of a residence and the categories of a budget with their annual amounts. */
export async function loadSplitInput(
  tx: Tx,
  residenceId: string,
  budgetId: string,
): Promise<{ units: ChargeUnit[]; categories: (ChargeCategory & { annual: Centimes })[] }> {
  const units = await tx
    .select({
      unitId: residenceUnit.unitId,
      buildingId: unit.buildingId,
      share: residenceUnit.share,
    })
    .from(residenceUnit)
    .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
    .where(eq(residenceUnit.residenceId, residenceId))
    .orderBy(asc(unit.code));
  const lines = await tx
    .select({
      id: chargeCategory.id,
      name: chargeCategory.name,
      nameAr: chargeCategory.nameAr,
      key: chargeCategory.key,
      weighting: chargeCategory.weighting,
      buildingId: chargeCategory.buildingId,
      annual: budgetLine.amount,
    })
    .from(budgetLine)
    .innerJoin(chargeCategory, eq(chargeCategory.id, budgetLine.categoryId))
    .where(eq(budgetLine.budgetId, budgetId))
    .orderBy(asc(chargeCategory.position), asc(chargeCategory.name));
  const custom =
    lines.length === 0
      ? []
      : await tx
          .select({ categoryId: chargeCategoryUnit.categoryId, unitId: chargeCategoryUnit.unitId })
          .from(chargeCategoryUnit)
          .where(
            inArray(
              chargeCategoryUnit.categoryId,
              lines.map((l) => l.id),
            ),
          );
  return {
    units,
    categories: lines.map((l) => ({
      ...l,
      unitIds: custom.filter((c) => c.categoryId === l.id).map((c) => c.unitId),
    })),
  };
}

/** Main co-owner of each unit on a day (the first by name when none is marked main). */
export async function mainCoOwners(tx: Tx, residenceId: string, day: string) {
  const rows = await tx
    .select({
      id: resident.id,
      unitId: resident.unitId,
      lastName: resident.lastName,
      firstName: resident.firstName,
      lastNameAr: resident.lastNameAr,
      firstNameAr: resident.firstNameAr,
      address: resident.address,
      phone: resident.phone,
      whatsappOptIn: resident.whatsappOptIn,
    })
    .from(resident)
    .where(
      and(
        eq(resident.residenceId, residenceId),
        eq(resident.kind, "co_owner"),
        currentResident(day),
      ),
    )
    .orderBy(desc(resident.isMain), asc(resident.lastName), asc(resident.firstName));
  const byUnit = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byUnit.has(row.unitId)) byUnit.set(row.unitId, row);
  return byUnit;
}

/**
 * Writes the calls of an issued period: one numbered call ADC-… per unit with its lines,
 * addressed to its main co-owner on the issue day; its PDF job and WhatsApp notice are queued
 * in the same transaction.
 */
export async function writeCalls(
  tx: Tx,
  ctx: TenantCtx,
  input: {
    residenceId: string;
    periodId: string;
    calls: ChargeCallDraft[];
    owners: Awaited<ReturnType<typeof mainCoOwners>>;
    issuedOn: string;
    dueOn: string;
  },
) {
  // Numbers follow the Algiers year of the issue day.
  const issuedAt = fromAlgiersDateTime(`${input.issuedOn}T12:00`) ?? new Date();
  for (const call of input.calls) {
    const owner = input.owners.get(call.unitId);
    const { number } = await nextDocumentNumber(tx, ctx, "charge_call", issuedAt);
    const [row] = await tx
      .insert(chargeCall)
      .values({
        organizationId: ctx.orgId,
        residenceId: input.residenceId,
        periodId: input.periodId,
        unitId: call.unitId,
        number,
        dueOn: input.dueOn,
        amount: call.amount,
        reserve: call.reserve,
        residentId: owner?.id ?? null,
        addresseeName: owner ? `${owner.lastName} ${owner.firstName}` : null,
        addresseeNameAr: owner
          ? [owner.lastNameAr, owner.firstNameAr].filter(Boolean).join(" ") || null
          : null,
        addresseeAddress: owner?.address ?? null,
      })
      .returning({ id: chargeCall.id });
    if (!row) throw new Error("writeCalls: no call returned");
    await tx.insert(chargeCallLine).values(
      call.lines.map((line, index) => ({
        organizationId: ctx.orgId,
        callId: row.id,
        position: index + 1,
        categoryId: line.categoryId,
        label: line.label,
        labelAr: line.labelAr,
        amount: line.amount,
      })),
    );
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "charge_call", id: row.id },
      { singletonKey: `charge_call:${row.id}` },
    );
    await notifyChargeCall(tx, ctx, {
      residenceId: input.residenceId,
      unitId: call.unitId,
      number,
      amount: call.amount,
      dueOn: input.dueOn,
      owner: owner
        ? {
            phone: owner.phone,
            name: `${owner.firstName} ${owner.lastName}`.trim(),
            optIn: owner.whatsappOptIn,
          }
        : null,
    });
  }
}

/**
 * Issues the charge calls of one period of an approved budget (CLAUDE.md §7 Residence
 * charges): one numbered call ADC-… per unit with something to pay, addressed to its main
 * co-owner on the issue day, with its lines; PDFs are rendered by the worker. Audited.
 */
export async function issueChargePeriod(ctx: TenantCtx, input: In<typeof issueChargePeriodSchema>) {
  assertCan(ctx, "charge:create");
  if (input.issuedOn > todayInAlgiers()) throw invalid("issuedOn", "charges.errors.futureDate");
  if (input.dueOn < input.issuedOn) throw invalid("dueOn", "charges.errors.dueBeforeIssue");
  const { budgetId, periodIndex } = input.period;
  return withTenant(ctx, async (tx) => {
    const source = await loadBudget(tx, budgetId);
    if (source.status !== "approved" || !source.frequency || source.reserveFundBp === null) {
      throw new AppError("CONFLICT", "charges.errors.budgetNotApproved");
    }
    if (periodIndex < 1 || periodIndex > callsPerYear[source.frequency]) {
      throw invalid("period", "charges.errors.periodOutOfRange");
    }
    const home = await loadResidence(tx, source.residenceId, { forUpdate: true });
    const [live] = await tx
      .select({ id: chargePeriod.id })
      .from(chargePeriod)
      .where(
        and(
          eq(chargePeriod.budgetId, source.id),
          eq(chargePeriod.periodIndex, periodIndex),
          eq(chargePeriod.status, "issued"),
        ),
      );
    if (live) throw new AppError("CONFLICT", "charges.errors.periodIssued");

    const split = buildChargeCalls({
      ...(await loadSplitInput(tx, home.id, source.id)),
      frequency: source.frequency,
      periodIndex,
      reserveFundBp: source.reserveFundBp,
      reserveLabel: RESERVE_LABEL,
    });
    if (split.problems.length > 0) throw new AppError("CONFLICT", "charges.errors.cannotSplit");
    if (split.calls.length === 0) throw new AppError("CONFLICT", "charges.errors.nothingToCall");
    const owners = await mainCoOwners(tx, home.id, input.issuedOn);

    const [period] = await tx
      .insert(chargePeriod)
      .values({
        organizationId: ctx.orgId,
        residenceId: home.id,
        budgetId: source.id,
        year: source.year,
        frequency: source.frequency,
        periodIndex,
        issuedOn: input.issuedOn,
        dueOn: input.dueOn,
        total: split.total,
        reserve: split.reserve,
        callCount: split.calls.length,
        issuedBy: ctx.userId,
      })
      .returning({ id: chargePeriod.id });
    if (!period) throw new Error("issueChargePeriod: no period returned");

    await writeCalls(tx, ctx, {
      residenceId: home.id,
      periodId: period.id,
      calls: split.calls,
      owners,
      issuedOn: input.issuedOn,
      dueOn: input.dueOn,
    });

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_period.issue",
      entityType: "charge_period",
      entityId: period.id,
      after: {
        residence: home.name,
        year: source.year,
        frequency: source.frequency,
        periodIndex,
        issuedOn: input.issuedOn,
        dueOn: input.dueOn,
        calls: split.calls.length,
        total: split.total,
        reserve: split.reserve,
      },
    });
    return { periodId: period.id, calls: split.calls.length, total: split.total };
  });
}

/**
 * Cancels an issued period with a reason (accountants): its calls no longer count in the units'
 * accounts — what was paid on them becomes an advance — and the period can be issued again.
 */
export async function cancelChargePeriod(
  ctx: TenantCtx,
  input: In<typeof cancelChargePeriodSchema>,
) {
  assertCan(ctx, "charge:cancel");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ status: chargePeriod.status, total: chargePeriod.total })
      .from(chargePeriod)
      .where(eq(chargePeriod.id, input.periodId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.status === "cancelled") {
      throw new AppError("CONFLICT", "charges.errors.periodCancelled");
    }
    await tx
      .update(chargePeriod)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: ctx.userId,
        cancellationReason: input.reason,
      })
      .where(eq(chargePeriod.id, input.periodId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_period.cancel",
      entityType: "charge_period",
      entityId: input.periodId,
      before: { status: "issued", total: current.total },
      after: { status: "cancelled" },
      reason: input.reason,
    });
  });
}
