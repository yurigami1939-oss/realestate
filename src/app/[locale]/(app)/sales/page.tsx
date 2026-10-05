import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { Pagination } from "@/components/data-table/pagination";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listSales } from "@/server/sales/sale-queries";
import { saleListParams } from "@/server/sales/schemas";

import { SaleFilters } from "./_components/sale-filters";
import { SalesTable } from "./_components/sales-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("title") };
}

export default async function SalesPage({ params, searchParams }: PageProps<"/[locale]/sales">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("sale:read");
  const raw = await searchParams;
  const filters = saleListParams.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const result = await listSales(ctx, filters);
  const t = await getTranslations("sales");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ExportButton kind="sales" params={{ q: filters.q, status: filters.status }} />
            {can(ctx.roles, "sale:create") ? (
              <Button asChild>
                <Link href="/sales/new">
                  <Plus data-icon="inline-start" />
                  {t("new")}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <SaleFilters />
      <p className="text-sm text-muted-foreground">{t("count", { count: result.total })}</p>
      <SalesTable rows={result.rows} empty={t("empty")} />
      <Pagination
        pathname="/sales"
        params={{ q: filters.q, status: filters.status }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
