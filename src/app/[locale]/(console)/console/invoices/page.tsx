import { Search } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { InvoiceStateBadge } from "@/components/subscription/invoice-state-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { invoiceStates } from "@/lib/billing";
import { formatDate } from "@/lib/dates";
import { formatDZD, sumCentimes } from "@/lib/money";
import { listInvoices } from "@/server/console/billing";
import { requireOperator } from "@/server/console/guard";
import { invoiceFiltersSchema } from "@/server/console/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.invoices");
  return { title: t("title") };
}

/** Every invoice issued (CLAUDE.console.md §10): searched by number or client, by state. */
export default async function ConsoleInvoicesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/console/invoices">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  await requireOperator();
  const query = await searchParams;
  const filters = invoiceFiltersSchema.parse({
    q: typeof query.q === "string" ? query.q : undefined,
    state: typeof query.state === "string" ? query.state : undefined,
  });
  const rows = await listInvoices(filters);
  const t = await getTranslations("console");
  const ts = await getTranslations("subscription.invoices.states");
  const money = (v: bigint) => formatDZD(v, locale);
  const select =
    "h-9 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.description")}
        actions={
          <span className="text-sm font-medium tabular-nums" data-testid="invoices-unpaid">
            {t("invoices.unpaid", { amount: money(sumCentimes(rows.map((r) => r.remaining))) })}
          </span>
        }
      />
      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("invoices.search")}
            aria-label={t("invoices.search")}
            className="ps-8"
          />
        </div>
        <select
          name="state"
          defaultValue={filters.state ?? ""}
          className={select}
          aria-label={t("billing.state")}
        >
          <option value="">{t("invoices.allStates")}</option>
          {invoiceStates.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          {t("invoices.filter")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="empty-state">{t("invoices.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-card">
          <Table stack data-testid="invoices">
            <TableHeader>
              <TableRow>
                <TableHead>{t("billing.number")}</TableHead>
                <TableHead>{t("invoices.account")}</TableHead>
                <TableHead>{t("billing.issuedOnShort")}</TableHead>
                <TableHead>{t("billing.dueOn")}</TableHead>
                <TableHead className="text-end">{t("billing.total")}</TableHead>
                <TableHead className="text-end">{t("billing.remaining")}</TableHead>
                <TableHead>{t("billing.state")}</TableHead>
                <TableHead>{t("billing.pdf")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium tabular-nums" dir="ltr">
                    {row.number}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/console/accounts/${row.billingAccountId}`}
                      data-row-link
                      className="hover:underline"
                    >
                      {row.legalName}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.issuedOn)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.dueOn)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(row.totalTtc)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(row.remaining)}</TableCell>
                  <TableCell>
                    <InvoiceStateBadge state={row.state} />
                  </TableCell>
                  <TableCell>
                    {row.hasPdf ? (
                      <a
                        href={`/api/console/documents/${row.id}`}
                        className="text-primary hover:underline"
                        target="_blank"
                        rel="noopener"
                      >
                        {t("billing.pdf")}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{t("billing.pdfPending")}</span>
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
