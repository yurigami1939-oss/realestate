import "server-only";

import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleReservation } from "@/server/sales/access";

import { loadOverdueSales, loadSaleReminders } from "./overdue";
import { OVERDUE_PAGE_SIZE } from "./schemas";

/** Overdue page: visible sales with overdue installments, most late first, with totals. */
export async function listOverdueSales(ctx: TenantCtx, params: { page?: number }) {
  assertCan(ctx, "sale:read");
  const page = params.page ?? 1;
  const all = await withTenant(ctx, (tx) => loadOverdueSales(tx, ctx.orgId, ctx));
  return {
    rows: all
      .slice((page - 1) * OVERDUE_PAGE_SIZE, page * OVERDUE_PAGE_SIZE)
      .map(({ statement: _statement, ...row }) => row),
    total: all.length,
    overdue: all.reduce((sum, row) => sum + row.overdue, 0n),
    penalties: all.reduce((sum, row) => sum + row.penalties, 0n),
    page,
    pageSize: OVERDUE_PAGE_SIZE,
  };
}

export type OverdueRow = Awaited<ReturnType<typeof listOverdueSales>>["rows"][number];

/** Reminder letters of a visible sale (sale page). */
export async function listSaleReminders(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, async (tx) => {
    await loadVisibleReservation(tx, ctx, reservationId);
    return loadSaleReminders(tx, reservationId);
  });
}
