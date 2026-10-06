import "server-only";

import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { marketingSpend } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { saveMarketingSpendSchema } from "./schemas";

/**
 * The marketing spend of a month on a lead source (`target:update`: gérant, directeur
 * commercial), replaced as a whole; 0 removes it. Audited on the organization.
 */
export async function saveMarketingSpend(
  ctx: TenantCtx,
  input: z.output<typeof saveMarketingSpendSchema>,
) {
  assertCan(ctx, "target:update");
  const month = `${input.month}-01`;
  await withTenant(ctx, async (tx) => {
    const where = and(eq(marketingSpend.month, month), eq(marketingSpend.source, input.source));
    if (input.amount === 0n) {
      await tx.delete(marketingSpend).where(where);
    } else {
      const values = { amount: input.amount, notes: input.notes, updatedBy: ctx.userId };
      await tx
        .insert(marketingSpend)
        .values({ organizationId: ctx.orgId, month, source: input.source, ...values })
        .onConflictDoUpdate({
          target: [marketingSpend.organizationId, marketingSpend.month, marketingSpend.source],
          set: { ...values, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.marketing_spend",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { month, source: input.source, amount: input.amount },
    });
  });
}
