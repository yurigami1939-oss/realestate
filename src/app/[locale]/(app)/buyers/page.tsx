import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { Pagination } from "@/components/data-table/pagination";
import { SearchInput } from "@/components/data-table/search-input";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listBuyers } from "@/server/buyers/queries";
import { buyerListParams } from "@/server/buyers/schemas";

import { BuyersTable } from "./_components/buyers-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("buyers");
  return { title: t("title") };
}

export default async function BuyersPage({ params, searchParams }: PageProps<"/[locale]/buyers">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("buyer:read");
  const raw = await searchParams;
  const filters = buyerListParams.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const result = await listBuyers(ctx, filters);
  const t = await getTranslations("buyers");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ExportButton kind="buyers" params={{ q: filters.q }} />
            {can(ctx.roles, "buyer:create") ? (
              <Button asChild>
                <Link href="/buyers/new">
                  <Plus data-icon="inline-start" />
                  {t("new")}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <SearchInput label={t("search")} />
      <p className="text-sm text-muted-foreground">{t("count", { count: result.total })}</p>
      <BuyersTable rows={result.rows} empty={t("empty")} />
      <Pagination
        pathname="/buyers"
        params={{ q: filters.q }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
