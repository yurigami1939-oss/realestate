import "server-only";

import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  installment,
  lead,
  marketingSpend,
  payment,
  project,
  reservation,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { leadSources } from "@/lib/crm";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import type { Centimes } from "@/lib/money";
import { ageingBucket, ageingBuckets, monthsOfPeriod } from "@/lib/reports";
import { computeStatement } from "@/lib/statement";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { ReportParams } from "./schemas";

const NO_PENALTIES = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };
/** Months of the collections forecast. */
export const FORECAST_MONTHS = 6;

const big = (v: string | null | undefined) => BigInt(v ?? "0");

/**
 * The management reports (`report:read`, CLAUDE.md §7 Reports) over a period (this year by
 * default), optionally for one project: sales and collections by month, sales by project and
 * typology, commercial performance; as of today: receivables by age, collections expected per
 * month, stock by project and typology.
 */
export async function getReports(ctx: TenantCtx, params: ReportParams) {
  assertCan(ctx, "report:read");
  const today = todayInAlgiers();
  const to = params.to ?? today;
  const from = params.from ?? `${to.slice(0, 4)}-01-01`;
  const projectId = params.project && isUuid(params.project) ? params.project : null;
  const ofProject = projectId ? eq(reservation.projectId, projectId) : undefined;
  return withTenant(ctx, async (tx) => {
    const projects = await tx
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(isNull(project.deletedAt))
      .orderBy(project.name);

    // Sales signed in the period (withdrawn ones counted apart).
    const signed = await tx
      .select({
        id: reservation.id,
        reservedOn: reservation.reservedOn,
        saleSignedOn: reservation.saleSignedOn,
        endedOn: reservation.endedOn,
        status: reservation.status,
        price: reservation.price,
        commercialUserId: reservation.commercialUserId,
        projectName: project.name,
        typology: unit.typology,
        type: unit.type,
        area: sql<string | null>`coalesce(${unit.livingArea}, ${unit.usableArea})::text`,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .where(and(ofProject, gte(reservation.reservedOn, from), lte(reservation.reservedOn, to)));
    const vsp = await tx
      .select({
        saleSignedOn: reservation.saleSignedOn,
        price: reservation.price,
        commercialUserId: reservation.commercialUserId,
      })
      .from(reservation)
      .where(
        and(
          ofProject,
          eq(reservation.status, "sold"),
          gte(reservation.saleSignedOn, from),
          lte(reservation.saleSignedOn, to),
        ),
      );
    const paid = await tx
      .select({
        month: sql<string>`to_char(${payment.paidOn}, 'YYYY-MM')`,
        commercialUserId: reservation.commercialUserId,
        total: sql<string>`sum(${payment.amount})::text`,
      })
      .from(payment)
      .innerJoin(reservation, eq(reservation.id, payment.reservationId))
      .where(
        and(
          ofProject,
          eq(payment.status, "valid"),
          gte(payment.paidOn, from),
          lte(payment.paidOn, to),
        ),
      )
      .groupBy(sql`1`, reservation.commercialUserId);

    const live = signed.filter((s) => s.status !== "withdrawn");
    const byMonth = monthsOfPeriod(from, to).map((month) => {
      const reserved = live.filter((s) => s.reservedOn.startsWith(month));
      const sold = vsp.filter((s) => s.saleSignedOn?.startsWith(month));
      return {
        month,
        reservations: reserved.length,
        reserved: reserved.reduce((sum, s) => sum + s.price, 0n),
        sales: sold.length,
        sold: sold.reduce((sum, s) => sum + s.price, 0n),
        collected: paid.filter((p) => p.month === month).reduce((sum, p) => sum + big(p.total), 0n),
      };
    });

    const groups = new Map<
      string,
      { projectName: string; typology: string; count: number; value: Centimes; area: number }
    >();
    for (const s of live) {
      const typology = s.typology ?? s.type;
      const key = `${s.projectName}|${typology}`;
      const group = groups.get(key) ?? {
        projectName: s.projectName,
        typology,
        count: 0,
        value: 0n,
        area: 0,
      };
      group.count += 1;
      group.value += s.price;
      group.area += s.area ? Number(s.area) : 0;
      groups.set(key, group);
    }
    const byTypology = [...groups.values()]
      .sort(
        (a, b) =>
          a.projectName.localeCompare(b.projectName) || a.typology.localeCompare(b.typology),
      )
      .map((g) => ({
        ...g,
        /** Average price per m² in centimes (null without areas). */
        perSquareMeter: g.area > 0 ? (g.value * 100n) / BigInt(Math.round(g.area * 100)) : null,
      }));

    // Commercial performance: the sales credited to each and the leads they were given.
    const leads = await tx
      .select({
        assignedTo: lead.assignedTo,
        total: sql<number>`count(*)::int`,
      })
      .from(lead)
      .where(
        and(
          isNull(lead.deletedAt),
          projectId ? eq(lead.projectId, projectId) : undefined,
          gte(sql`(${lead.createdAt} at time zone 'Africa/Algiers')::date`, from),
          lte(sql`(${lead.createdAt} at time zone 'Africa/Algiers')::date`, to),
        ),
      )
      .groupBy(lead.assignedTo);
    const commercialIds = new Set<string>(
      [...live, ...vsp, ...leads.map((l) => ({ commercialUserId: l.assignedTo }))].flatMap((s) =>
        s.commercialUserId ? [s.commercialUserId] : [],
      ),
    );
    const names = new Map(
      commercialIds.size === 0
        ? []
        : (
            await tx
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(inArray(user.id, [...commercialIds]))
          ).map((m) => [m.id, m.name]),
    );
    const commercials = [...commercialIds]
      .map((id) => {
        const own = live.filter((s) => s.commercialUserId === id);
        const ownLeads = leads.find((l) => l.assignedTo === id);
        return {
          userId: id,
          name: names.get(id) ?? "—",
          leads: ownLeads?.total ?? 0,
          reservations: own.length,
          reserved: own.reduce((sum, s) => sum + s.price, 0n),
          sales: vsp.filter((s) => s.commercialUserId === id).length,
          collected: paid
            .filter((p) => p.commercialUserId === id)
            .reduce((sum, p) => sum + big(p.total), 0n),
          /** Reservations per 100 leads given in the period (null without leads). */
          conversionBp:
            ownLeads && ownLeads.total > 0
              ? Math.round((own.length * 10_000) / ownLeads.total)
              : null,
        };
      })
      .sort((a, b) => (b.reserved > a.reserved ? 1 : b.reserved < a.reserved ? -1 : 0));

    // As of today: receivables by age and the collections expected per month.
    const open = await tx
      .select({ id: reservation.id })
      .from(reservation)
      .where(and(ofProject, inArray(reservation.status, ["reserved", "sold"])));
    const openIds = open.map((s) => s.id);
    const ageing = Object.fromEntries(ageingBuckets.map((b) => [b, 0n])) as Record<
      (typeof ageingBuckets)[number],
      Centimes
    >;
    const forecastMonths = monthsOfPeriod(today, null, FORECAST_MONTHS);
    const forecast = new Map<string, Centimes>(forecastMonths.map((m) => [m, 0n]));
    let forecastLater = 0n;
    if (openIds.length > 0) {
      const lines = await tx
        .select({
          reservationId: installment.reservationId,
          position: installment.position,
          label: installment.label,
          amount: installment.amount,
          dueOn: installment.dueOn,
        })
        .from(installment)
        .where(inArray(installment.reservationId, openIds));
      const totals = await tx
        .select({
          reservationId: payment.reservationId,
          total: sql<string>`sum(${payment.amount})::text`,
        })
        .from(payment)
        .where(and(inArray(payment.reservationId, openIds), eq(payment.status, "valid")))
        .groupBy(payment.reservationId);
      const current = forecastMonths[0] ?? today.slice(0, 7);
      for (const id of openIds) {
        const statement = computeStatement(
          lines.filter((l) => l.reservationId === id),
          big(totals.find((t) => t.reservationId === id)?.total),
          today,
          NO_PENALTIES,
        );
        for (const line of statement.lines) {
          if (line.remaining === 0n) continue;
          ageing[ageingBucket(line.dueOn, today)] += line.remaining;
          if (line.dueOn === null) continue;
          const month = line.dueOn.slice(0, 7) < current ? current : line.dueOn.slice(0, 7);
          if (forecast.has(month))
            forecast.set(month, (forecast.get(month) ?? 0n) + line.remaining);
          else forecastLater += line.remaining;
        }
      }
    }

    // Stock by project and typology, as of today.
    const stock = await tx
      .select({
        projectName: project.name,
        typology: sql<string>`coalesce(${unit.typology}::text, ${unit.type}::text)`,
        available: sql<number>`count(*) filter (where ${unit.status} = 'available')::int`,
        optioned: sql<number>`count(*) filter (where ${unit.status} = 'optioned')::int`,
        reserved: sql<number>`count(*) filter (where ${unit.status} = 'reserved')::int`,
        sold: sql<number>`count(*) filter (where ${unit.status} in ('sold', 'delivered'))::int`,
        value: sql<string>`coalesce(sum(${unit.listPrice}) filter (where ${unit.status} in ('available', 'optioned')), 0)::text`,
      })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(
        and(
          isNull(unit.deletedAt),
          isNull(project.deletedAt),
          ne(unit.status, "rented"),
          projectId ? eq(unit.projectId, projectId) : undefined,
        ),
      )
      .groupBy(project.name, sql`2`)
      .orderBy(project.name, sql`2`);

    return {
      from,
      to,
      today,
      projectId,
      projects,
      totals: {
        reservations: live.length,
        reserved: live.reduce((sum, s) => sum + s.price, 0n),
        withdrawn: signed.filter((s) => s.status === "withdrawn").length,
        sales: vsp.length,
        sold: vsp.reduce((sum, s) => sum + s.price, 0n),
        collected: paid.reduce((sum, p) => sum + big(p.total), 0n),
      },
      byMonth,
      byTypology,
      commercials,
      ageing,
      forecast: forecastMonths.map((month) => ({ month, expected: forecast.get(month) ?? 0n })),
      forecastLater,
      stock: stock.map((s) => ({ ...s, value: big(s.value) })),
      sources: await leadSourceReport(tx, { from, to, projectId }),
    };
  });
}

/**
 * Cost and return per lead source over the period: leads received, reservations signed (not
 * withdrawn) by those leads and their amount, against the marketing spend of the period's
 * months (organization-wide), with the cost per lead and per sale.
 */
async function leadSourceReport(
  tx: Tx,
  { from, to, projectId }: { from: string; to: string; projectId: string | null },
) {
  const leads = await tx
    .select({ source: lead.source, n: sql<number>`count(*)::int` })
    .from(lead)
    .where(
      and(
        isNull(lead.deletedAt),
        projectId ? eq(lead.projectId, projectId) : undefined,
        gte(sql`(${lead.createdAt} at time zone 'Africa/Algiers')::date`, from),
        lte(sql`(${lead.createdAt} at time zone 'Africa/Algiers')::date`, to),
      ),
    )
    .groupBy(lead.source);
  const won = await tx
    .select({
      source: lead.source,
      n: sql<number>`count(*)::int`,
      value: sql<string>`sum(${reservation.price})::text`,
    })
    .from(reservation)
    .innerJoin(lead, eq(lead.id, reservation.leadId))
    .where(
      and(
        projectId ? eq(reservation.projectId, projectId) : undefined,
        ne(reservation.status, "withdrawn"),
        gte(reservation.reservedOn, from),
        lte(reservation.reservedOn, to),
      ),
    )
    .groupBy(lead.source);
  const spend = await tx
    .select({
      source: marketingSpend.source,
      total: sql<string>`sum(${marketingSpend.amount})::text`,
    })
    .from(marketingSpend)
    .where(
      and(
        gte(marketingSpend.month, `${from.slice(0, 7)}-01`),
        lte(marketingSpend.month, `${to.slice(0, 7)}-01`),
      ),
    )
    .groupBy(marketingSpend.source);
  return leadSources
    .map((source) => {
      const leadCount = leads.find((l) => l.source === source)?.n ?? 0;
      const sales = won.find((w) => w.source === source);
      const cost = big(spend.find((x) => x.source === source)?.total);
      const reservations = sales?.n ?? 0;
      return {
        source,
        leads: leadCount,
        reservations,
        revenue: big(sales?.value),
        spend: cost,
        /** Centimes per lead / per reservation (null without any). */
        costPerLead: leadCount > 0 && cost > 0n ? cost / BigInt(leadCount) : null,
        costPerSale: reservations > 0 && cost > 0n ? cost / BigInt(reservations) : null,
      };
    })
    .filter((r) => r.leads > 0 || r.reservations > 0 || r.spend > 0n);
}

export type Reports = Awaited<ReturnType<typeof getReports>>;
