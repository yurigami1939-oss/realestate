import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { DeliveryStateBadge } from "@/components/handovers/badges";
import { DeliveryFilters } from "@/components/handovers/delivery-filters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime } from "@/lib/dates";
import { type DeliveryState, deliveryStates } from "@/lib/handovers";
import { formatDZD } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { listDeliveries } from "@/server/handovers/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("handovers");
  return { title: t("title") };
}

const isState = (value: string): value is DeliveryState =>
  (deliveryStates as readonly string[]).includes(value);

/** Deliveries: sold units with their handover state, what needs doing first. */
export default async function DeliveriesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/deliveries">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("handover:read");
  const query = await searchParams;
  const projectId = typeof query.project === "string" ? query.project : undefined;
  const rawState = typeof query.state === "string" ? query.state : "";
  const state = rawState === "all" ? "all" : isState(rawState) ? rawState : undefined;
  const { items, counts, projects } = await listDeliveries(ctx, { projectId, state });
  const t = await getTranslations("handovers");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="flex flex-wrap gap-2 text-sm" data-testid="delivery-counts">
        {deliveryStates.map((s) => (
          <li key={s}>
            <Link
              href={`/deliveries?state=${s}${projectId ? `&project=${projectId}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-muted"
            >
              <DeliveryStateBadge state={s} />
              <span className="font-semibold tabular-nums">{counts[s]}</span>
            </Link>
          </li>
        ))}
      </ul>
      <DeliveryFilters projects={projects} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="deliveries">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.unit")}</TableHead>
                <TableHead>{t("columns.buyers")}</TableHead>
                <TableHead>{t("columns.vsp")}</TableHead>
                <TableHead>{t("columns.appointment")}</TableHead>
                <TableHead>{t("columns.state")}</TableHead>
                <TableHead>{t("columns.reserves")}</TableHead>
                <TableHead className="text-end">{t("columns.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.saleId} data-unit={d.unitCode}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/deliveries/${d.saleId}`} className="font-medium hover:underline">
                      <bdi dir="ltr">{d.unitCode}</bdi>
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {d.projectName} · {d.buildingName}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">{d.buyers}</TableCell>
                  <TableCell>{d.saleSignedOn ? formatDate(d.saleSignedOn) : "—"}</TableCell>
                  <TableCell className="whitespace-normal">
                    {d.number && d.signedOn
                      ? t("pvOn", { number: d.number, date: formatDate(d.signedOn) })
                      : d.scheduledAt
                        ? t("appointmentAt", { date: formatDateTime(d.scheduledAt) })
                        : "—"}
                  </TableCell>
                  <TableCell>
                    <DeliveryStateBadge state={d.state} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {t("reservesOpen", { count: d.openReserves })}
                    {d.lateReserves > 0 ? (
                      <span className="block text-xs text-red-800">
                        {t("reservesLate", { count: d.lateReserves })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {d.remaining > 0n ? (
                      <bdi dir="ltr">{formatDZD(d.remaining, locale)}</bdi>
                    ) : (
                      t("paid")
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
