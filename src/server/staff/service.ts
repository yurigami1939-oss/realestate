import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { salaryAdvance, staffMember, staffPay } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";
import { checkCategory } from "@/server/suppliers/service";

import type {
  createStaffSchema,
  endStaffSchema,
  recordAdvanceSchema,
  updateStaffSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A live staff member (locked); NOT_FOUND otherwise. */
export async function loadStaff(tx: Tx, staffId: string) {
  const [row] = await tx
    .select()
    .from(staffMember)
    .where(and(eq(staffMember.id, staffId), isNull(staffMember.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** New agent of a residence (staff:update). Audited: the salary is money. */
export async function createStaff(ctx: TenantCtx, input: In<typeof createStaffSchema>) {
  assertCan(ctx, "staff:update");
  const { residenceId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, residenceId);
    await checkCategory(tx, home.id, fields.categoryId);
    const [row] = await tx
      .insert(staffMember)
      .values({ ...fields, organizationId: ctx.orgId, residenceId: home.id, createdBy: ctx.userId })
      .returning({ id: staffMember.id });
    if (!row) throw new Error("createStaff: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "staff_member.create",
      entityType: "staff_member",
      entityId: row.id,
      after: {
        name: `${fields.lastName} ${fields.firstName}`,
        role: fields.role,
        monthlySalary: fields.monthlySalary,
        hiredOn: fields.hiredOn,
      },
    });
    return { id: row.id };
  });
}

export async function updateStaff(ctx: TenantCtx, input: In<typeof updateStaffSchema>) {
  assertCan(ctx, "staff:update");
  const { staffId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const current = await loadStaff(tx, staffId);
    await checkCategory(tx, current.residenceId, fields.categoryId);
    if (current.leftOn && current.leftOn < fields.hiredOn) {
      throw invalid("hiredOn", "staff.errors.leftBeforeHired");
    }
    await tx.update(staffMember).set(fields).where(eq(staffMember.id, staffId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "staff_member.update",
      entityType: "staff_member",
      entityId: staffId,
      before: { role: current.role, monthlySalary: current.monthlySalary },
      after: { role: fields.role, monthlySalary: fields.monthlySalary },
    });
  });
}

/** Records the last day worked (departure, end of contract). Audited. */
export async function endStaff(ctx: TenantCtx, input: In<typeof endStaffSchema>) {
  assertCan(ctx, "staff:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadStaff(tx, input.staffId);
    if (input.leftOn < current.hiredOn) throw invalid("leftOn", "staff.errors.leftBeforeHired");
    await tx
      .update(staffMember)
      .set({ leftOn: input.leftOn })
      .where(eq(staffMember.id, input.staffId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "staff_member.end",
      entityType: "staff_member",
      entityId: input.staffId,
      after: { leftOn: input.leftOn },
    });
  });
}

/** Advances of a month are locked once its pay is recorded (the pay deducts their total). */
async function assertNoPay(tx: Tx, staffId: string, month: string) {
  const [pay] = await tx
    .select({ id: staffPay.id })
    .from(staffPay)
    .where(and(eq(staffPay.staffId, staffId), eq(staffPay.month, month)));
  if (pay) throw new AppError("CONFLICT", "staff.errors.payRecorded");
}

/** Salary advance paid to an agent, deducted from a month's pay. Audited. */
export async function recordAdvance(ctx: TenantCtx, input: In<typeof recordAdvanceSchema>) {
  assertCan(ctx, "staff:update");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "charges.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const agent = await loadStaff(tx, input.staffId);
    if (input.paidOn < agent.hiredOn || (agent.leftOn && input.paidOn > agent.leftOn)) {
      throw invalid("paidOn", "staff.errors.notEmployed");
    }
    await assertNoPay(tx, agent.id, input.month);
    const [row] = await tx
      .insert(salaryAdvance)
      .values({ ...input, organizationId: ctx.orgId, recordedBy: ctx.userId })
      .returning({ id: salaryAdvance.id });
    if (!row) throw new Error("recordAdvance: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "salary_advance.create",
      entityType: "staff_member",
      entityId: agent.id,
      after: { amount: input.amount, paidOn: input.paidOn, month: input.month },
    });
    return { id: row.id };
  });
}

/** Removes an advance recorded by mistake (soft delete). Audited. */
export async function deleteAdvance(ctx: TenantCtx, advanceId: string) {
  assertCan(ctx, "staff:update");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(salaryAdvance)
      .where(and(eq(salaryAdvance.id, advanceId), isNull(salaryAdvance.deletedAt)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    await assertNoPay(tx, current.staffId, current.month);
    await tx
      .update(salaryAdvance)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(salaryAdvance.id, advanceId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "salary_advance.delete",
      entityType: "staff_member",
      entityId: current.staffId,
      before: { amount: current.amount, paidOn: current.paidOn, month: current.month },
    });
  });
}
