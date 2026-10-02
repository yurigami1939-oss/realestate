import "server-only";

import { and, eq, type SQL } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { reservation } from "@/db/schema";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import type { TenantCtx } from "@/server/auth/session";

/** Managers, cashiers and accountants see every sale; a commercial the sales credited to them. */
export const seesAllSales = (ctx: Pick<TenantCtx, "roles">) => can(ctx.roles, "sale:read_all");

export function visibleSales(ctx: TenantCtx): SQL | undefined {
  return seesAllSales(ctx) ? undefined : eq(reservation.commercialUserId, ctx.userId);
}

/** A reservation the member may see (locked when asked); NOT_FOUND otherwise. */
export async function loadVisibleReservation(
  tx: Tx,
  ctx: TenantCtx,
  reservationId: string,
  options: { forUpdate?: boolean } = {},
) {
  const query = tx
    .select()
    .from(reservation)
    .where(and(eq(reservation.id, reservationId), visibleSales(ctx)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}
