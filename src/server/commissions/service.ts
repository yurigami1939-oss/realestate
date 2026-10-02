import "server-only";

import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { commission, commissionRate } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { assertLeadOwner } from "@/server/crm/access";

import type { commissionRatesSchema, payCommissionSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Accountant: an earned commission was paid out (audited). */
export async function payCommission(ctx: TenantCtx, input: In<typeof payCommissionSchema>) {
  assertCan(ctx, "commission:update");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "sales.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(commission)
      .where(eq(commission.id, input.commissionId))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND");
    if (row.status !== "earned") throw new AppError("CONFLICT", "commissions.errors.notEarned");
    if (input.paidOn < row.earnedOn) throw invalid("paidOn", "commissions.errors.beforeEarned");
    await tx
      .update(commission)
      .set({ status: "paid", paidOn: input.paidOn, paidBy: ctx.userId })
      .where(eq(commission.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "commission.pay",
      entityType: "commission",
      entityId: row.id,
      before: { status: "earned" },
      after: { status: "paid", amount: row.amount, paidOn: input.paidOn },
    });
  });
}

/**
 * Gérant: commission rate per commercial, overriding the company default; an empty rate
 * goes back to the default. Rates apply to sales signed afterwards (each commission keeps
 * the rate it was earned at).
 */
export async function saveCommissionRates(ctx: TenantCtx, input: In<typeof commissionRatesSchema>) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    for (const [index, { userId, rate }] of input.rates.entries()) {
      await assertLeadOwner(tx, ctx.orgId, userId, `rates.${index}.userId`);
      if (rate === null) {
        await tx
          .delete(commissionRate)
          .where(
            and(eq(commissionRate.organizationId, ctx.orgId), eq(commissionRate.userId, userId)),
          );
        continue;
      }
      await tx
        .insert(commissionRate)
        .values({ organizationId: ctx.orgId, userId, rateBp: rate, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [commissionRate.organizationId, commissionRate.userId],
          set: { rateBp: rate, updatedBy: ctx.userId, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "commission.rates",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { rates: input.rates },
    });
  });
}
