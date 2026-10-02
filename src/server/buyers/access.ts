import "server-only";

import { and, eq, isNull, type SQL } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { buyer } from "@/db/schema";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import type { TenantCtx } from "@/server/auth/session";

/** Managers, cashiers and accountants see every buyer; a commercial the buyers they follow. */
export const seesAllBuyers = (ctx: Pick<TenantCtx, "roles">) => can(ctx.roles, "buyer:read_all");

export function visibleBuyers(ctx: TenantCtx): SQL | undefined {
  return seesAllBuyers(ctx) ? undefined : eq(buyer.ownerUserId, ctx.userId);
}

/** A live buyer the member may see (locked when asked); NOT_FOUND otherwise. */
export async function loadVisibleBuyer(
  tx: Tx,
  ctx: TenantCtx,
  buyerId: string,
  options: { forUpdate?: boolean } = {},
) {
  const query = tx
    .select()
    .from(buyer)
    .where(and(eq(buyer.id, buyerId), isNull(buyer.deletedAt), visibleBuyers(ctx)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}
