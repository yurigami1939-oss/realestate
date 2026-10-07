import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  chargeRecovery,
  chargeRecoveryStep,
  chargeRepaymentPlan,
  residenceUnit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import type { Centimes } from "@/lib/money";
import { planLines, planProgress, type RecoveryStepKind } from "@/lib/recovery";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { chargeStatement, liveCalls, paidByUnit } from "./accounts";
import type {
  addRecoveryStepSchema,
  cancelRepaymentPlanSchema,
  closeRecoverySchema,
  createRepaymentPlanSchema,
  openRecoverySchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A unit's account today: overdue, what remains called, and the total paid. */
async function unitPosition(tx: Tx, residenceId: string, unitId: string) {
  const calls = await liveCalls(tx, residenceId, [unitId]);
  const paid = (await paidByUnit(tx, residenceId, [unitId])).get(unitId) ?? 0n;
  const statement = chargeStatement(calls, paid, todayInAlgiers());
  return { overdue: statement.overdue, paid };
}

async function loadOpenRecovery(tx: Tx, recoveryId: string) {
  if (!isUuid(recoveryId)) throw new AppError("NOT_FOUND");
  const [row] = await tx
    .select()
    .from(chargeRecovery)
    .where(eq(chargeRecovery.id, recoveryId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  if (row.closedOn) throw new AppError("CONFLICT", "charges.recovery.errors.closed");
  return row;
}

/**
 * Opens the recovery file of a unit with overdue charges (`charge:remind`): one open per unit.
 * Audited on the residence.
 */
export async function openRecovery(ctx: TenantCtx, input: In<typeof openRecoverySchema>) {
  assertCan(ctx, "charge:remind");
  return withTenant(ctx, async (tx) => {
    const [member] = await tx
      .select({ unitId: residenceUnit.unitId })
      .from(residenceUnit)
      .where(
        and(
          eq(residenceUnit.residenceId, input.residenceId),
          eq(residenceUnit.unitId, input.unitId),
        ),
      );
    if (!member) throw new AppError("NOT_FOUND");
    const { overdue } = await unitPosition(tx, input.residenceId, input.unitId);
    if (overdue === 0n) throw new AppError("CONFLICT", "charges.errors.nothingOverdue");
    const [open] = await tx
      .select({ id: chargeRecovery.id })
      .from(chargeRecovery)
      .where(
        and(
          eq(chargeRecovery.residenceId, input.residenceId),
          eq(chargeRecovery.unitId, input.unitId),
          isNull(chargeRecovery.closedOn),
        ),
      );
    if (open) throw new AppError("CONFLICT", "charges.recovery.errors.alreadyOpen");
    const [row] = await tx
      .insert(chargeRecovery)
      .values({
        organizationId: ctx.orgId,
        residenceId: input.residenceId,
        unitId: input.unitId,
        openedOn: todayInAlgiers(),
        createdBy: ctx.userId,
      })
      .returning({ id: chargeRecovery.id });
    if (!row) throw new Error("openRecovery: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_recovery.open",
      entityType: "residence",
      entityId: input.residenceId,
      after: { recoveryId: row.id, unitId: input.unitId, overdue },
    });
    return { id: row.id };
  });
}

/** A step done (reminder, formal notice, bailiff, court, judgment, agreement, note): dated, final. */
export async function addRecoveryStep(ctx: TenantCtx, input: In<typeof addRecoveryStepSchema>) {
  assertCan(ctx, "charge:remind");
  if (input.doneOn > todayInAlgiers()) throw invalid("doneOn", "charges.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const file = await loadOpenRecovery(tx, input.recoveryId);
    if (input.doneOn < file.openedOn) {
      throw invalid("doneOn", "charges.recovery.errors.beforeOpening");
    }
    await tx.insert(chargeRecoveryStep).values({
      organizationId: ctx.orgId,
      recoveryId: file.id,
      kind: input.kind,
      doneOn: input.doneOn,
      note: input.note,
      createdBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_recovery.step",
      entityType: "residence",
      entityId: file.residenceId,
      after: { recoveryId: file.id, unitId: file.unitId, kind: input.kind, doneOn: input.doneOn },
    });
  });
}

/**
 * Échéancier d'apurement: the arrears (at most what is overdue today) spread over 1 to 24
 * monthly parts from a day on (not in the past); one live plan per file. Its progress is what
 * the unit pays from now on. Audited.
 */
export async function createRepaymentPlan(
  ctx: TenantCtx,
  input: In<typeof createRepaymentPlanSchema>,
) {
  assertCan(ctx, "charge:remind");
  if (input.firstDueOn < todayInAlgiers()) {
    throw invalid("firstDueOn", "charges.recovery.errors.pastStart");
  }
  return withTenant(ctx, async (tx) => {
    const file = await loadOpenRecovery(tx, input.recoveryId);
    const [live] = await tx
      .select({ id: chargeRepaymentPlan.id })
      .from(chargeRepaymentPlan)
      .where(
        and(eq(chargeRepaymentPlan.recoveryId, file.id), isNull(chargeRepaymentPlan.cancelledAt)),
      );
    if (live) throw new AppError("CONFLICT", "charges.recovery.errors.planExists");
    const { overdue, paid } = await unitPosition(tx, file.residenceId, file.unitId);
    if (input.total > overdue) throw invalid("total", "charges.recovery.errors.aboveOverdue");
    const lines = planLines(input.total, input.months, input.firstDueOn);
    const [row] = await tx
      .insert(chargeRepaymentPlan)
      .values({
        organizationId: ctx.orgId,
        recoveryId: file.id,
        total: input.total,
        months: input.months,
        firstDueOn: input.firstDueOn,
        lines: lines.map((l) => ({ dueOn: l.dueOn, amount: l.amount.toString() })),
        paidBefore: paid,
        createdBy: ctx.userId,
      })
      .returning({ id: chargeRepaymentPlan.id });
    if (!row) throw new Error("createRepaymentPlan: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_recovery.plan",
      entityType: "residence",
      entityId: file.residenceId,
      after: {
        recoveryId: file.id,
        unitId: file.unitId,
        total: input.total,
        months: input.months,
        firstDueOn: input.firstDueOn,
      },
    });
    return { id: row.id };
  });
}

/** A plan given up (broken, renegotiated) with a reason. */
export async function cancelRepaymentPlan(
  ctx: TenantCtx,
  input: In<typeof cancelRepaymentPlanSchema>,
) {
  assertCan(ctx, "charge:remind");
  await withTenant(ctx, async (tx) => {
    const [plan] = await tx
      .update(chargeRepaymentPlan)
      .set({ cancelledAt: new Date(), cancellationReason: input.reason })
      .where(and(eq(chargeRepaymentPlan.id, input.planId), isNull(chargeRepaymentPlan.cancelledAt)))
      .returning({ recoveryId: chargeRepaymentPlan.recoveryId });
    if (!plan) throw new AppError("NOT_FOUND");
    const file = await loadOpenRecovery(tx, plan.recoveryId);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_recovery.plan_cancel",
      entityType: "residence",
      entityId: file.residenceId,
      after: { recoveryId: file.id, planId: input.planId },
      reason: input.reason,
    });
  });
}

/** The file closed (arrears settled, or given up) with a reason; a live plan ends with it. */
export async function closeRecovery(ctx: TenantCtx, input: In<typeof closeRecoverySchema>) {
  assertCan(ctx, "charge:remind");
  await withTenant(ctx, async (tx) => {
    const file = await loadOpenRecovery(tx, input.recoveryId);
    await tx
      .update(chargeRecovery)
      .set({ closedOn: todayInAlgiers(), closeReason: input.reason, updatedAt: new Date() })
      .where(eq(chargeRecovery.id, file.id));
    await tx
      .update(chargeRepaymentPlan)
      .set({ cancelledAt: new Date(), cancellationReason: input.reason })
      .where(
        and(eq(chargeRepaymentPlan.recoveryId, file.id), isNull(chargeRepaymentPlan.cancelledAt)),
      );
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_recovery.close",
      entityType: "residence",
      entityId: file.residenceId,
      after: { recoveryId: file.id, unitId: file.unitId },
      reason: input.reason,
    });
  });
}

/** The open recovery file of a unit with its steps and live plan (and its progress), or null. */
export async function getUnitRecovery(ctx: TenantCtx, residenceId: string, unitId: string) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId) || !isUuid(unitId)) return null;
  return withTenant(ctx, async (tx) => {
    const [file] = await tx
      .select()
      .from(chargeRecovery)
      .where(
        and(
          eq(chargeRecovery.residenceId, residenceId),
          eq(chargeRecovery.unitId, unitId),
          isNull(chargeRecovery.closedOn),
        ),
      );
    if (!file) return null;
    const steps = await tx
      .select({
        id: chargeRecoveryStep.id,
        kind: chargeRecoveryStep.kind,
        doneOn: chargeRecoveryStep.doneOn,
        note: chargeRecoveryStep.note,
        byName: user.name,
      })
      .from(chargeRecoveryStep)
      .innerJoin(user, eq(user.id, chargeRecoveryStep.createdBy))
      .where(eq(chargeRecoveryStep.recoveryId, file.id))
      .orderBy(desc(chargeRecoveryStep.doneOn), desc(chargeRecoveryStep.createdAt));
    const [plan] = await tx
      .select()
      .from(chargeRepaymentPlan)
      .where(
        and(eq(chargeRepaymentPlan.recoveryId, file.id), isNull(chargeRepaymentPlan.cancelledAt)),
      );
    const position = await unitPosition(tx, residenceId, unitId);
    const lines = (plan?.lines ?? []).map((l) => ({ dueOn: l.dueOn, amount: BigInt(l.amount) }));
    return {
      ...file,
      overdue: position.overdue,
      steps,
      plan: plan
        ? {
            id: plan.id,
            total: plan.total,
            months: plan.months,
            firstDueOn: plan.firstDueOn,
            lines,
            progress: planProgress(lines, position.paid - plan.paidBefore, todayInAlgiers()),
          }
        : null,
    };
  });
}

export type UnitRecovery = NonNullable<Awaited<ReturnType<typeof getUnitRecovery>>>;

/** Open files of these units (overdue list): the last step and whether the plan is late. */
export async function recoveryStatus(
  tx: Tx,
  residenceId: string,
  paid: Map<string, Centimes>,
): Promise<Map<string, { lastStep: RecoveryStepKind | null; planLate: boolean | null }>> {
  const files = await tx
    .select({ id: chargeRecovery.id, unitId: chargeRecovery.unitId })
    .from(chargeRecovery)
    .where(and(eq(chargeRecovery.residenceId, residenceId), isNull(chargeRecovery.closedOn)));
  const status = new Map<string, { lastStep: RecoveryStepKind | null; planLate: boolean | null }>();
  if (files.length === 0) return status;
  const ids = files.map((f) => f.id);
  const steps = await tx
    .select({ recoveryId: chargeRecoveryStep.recoveryId, kind: chargeRecoveryStep.kind })
    .from(chargeRecoveryStep)
    .where(inArray(chargeRecoveryStep.recoveryId, ids))
    .orderBy(asc(chargeRecoveryStep.doneOn), asc(chargeRecoveryStep.createdAt));
  const plans = await tx
    .select()
    .from(chargeRepaymentPlan)
    .where(
      and(inArray(chargeRepaymentPlan.recoveryId, ids), isNull(chargeRepaymentPlan.cancelledAt)),
    );
  const today = todayInAlgiers();
  for (const file of files) {
    const own = steps.filter((s) => s.recoveryId === file.id);
    const plan = plans.find((p) => p.recoveryId === file.id);
    status.set(file.unitId, {
      lastStep: own.at(-1)?.kind ?? null,
      planLate: plan
        ? planProgress(
            plan.lines.map((l) => ({ dueOn: l.dueOn, amount: BigInt(l.amount) })),
            (paid.get(file.unitId) ?? 0n) - plan.paidBefore,
            today,
          ).late > 0n
        : null,
    });
  }
  return status;
}
