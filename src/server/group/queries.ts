import "server-only";

import { todayInAlgiers } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { ageingBuckets } from "@/lib/reports";
import type { TenantCtx } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/organizations/queries";
import { getReports } from "@/server/reports/queries";
import { listAccounts } from "@/server/treasury/queries";

export type GroupCompany = {
  id: string;
  name: string;
  active: boolean;
  reservations: number;
  reserved: Centimes;
  sales: number;
  collected: Centimes;
  overdue: Centimes;
  expected: Centimes;
  available: number;
  stockValue: Centimes;
  cash: Centimes;
};

const late = ageingBuckets.filter((b) => b !== "not_due" && b !== "undated");

/**
 * Consolidated view of a gérant's companies (CLAUDE.md §7 Reports): for every organization the
 * member runs (role `owner`), this year's sales and collections, what is overdue and expected,
 * the stock for sale and the cash on its accounts, read with that organization's own tenant
 * context (its RLS); null when the member runs fewer than two companies.
 */
export async function getGroupOverview(ctx: TenantCtx): Promise<{
  year: string;
  companies: GroupCompany[];
  total: Omit<GroupCompany, "id" | "name" | "active">;
} | null> {
  const owned = (await listUserOrganizations(ctx.userId)).filter((o) => o.roles.includes("owner"));
  if (owned.length < 2 || !owned.some((o) => o.id === ctx.orgId)) return null;
  const today = todayInAlgiers();
  const year = today.slice(0, 4);
  const companies: GroupCompany[] = [];
  for (const org of owned) {
    const orgCtx: TenantCtx = {
      userId: ctx.userId,
      orgId: org.id,
      roles: org.roles,
      locale: ctx.locale,
    };
    const report = await getReports(orgCtx, { from: `${year}-01-01`, to: today });
    const accounts = await listAccounts(orgCtx);
    companies.push({
      id: org.id,
      name: org.name,
      active: org.id === ctx.orgId,
      reservations: report.totals.reservations,
      reserved: report.totals.reserved,
      sales: report.totals.sales,
      collected: report.totals.collected,
      overdue: late.reduce((sum, b) => sum + report.ageing[b], 0n),
      expected: report.forecast.reduce((sum, m) => sum + m.expected, 0n),
      available: report.stock.reduce((sum, s) => sum + s.available + s.optioned, 0),
      stockValue: report.stock.reduce((sum, s) => sum + s.value, 0n),
      cash: accounts.filter((a) => a.closedOn === null).reduce((sum, a) => sum + a.balance, 0n),
    });
  }
  const add = <K extends keyof GroupCompany>(key: K) =>
    companies.reduce((sum, c) => sum + (c[key] as bigint), 0n);
  const count = <K extends keyof GroupCompany>(key: K) =>
    companies.reduce((sum, c) => sum + (c[key] as number), 0);
  return {
    year,
    companies,
    total: {
      reservations: count("reservations"),
      reserved: add("reserved"),
      sales: count("sales"),
      collected: add("collected"),
      overdue: add("overdue"),
      expected: add("expected"),
      available: count("available"),
      stockValue: add("stockValue"),
      cash: add("cash"),
    },
  };
}
