import { Copy, Plus } from "lucide-react";
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
import { listLeadOwners, listLeads } from "@/server/crm/queries";
import { leadListParams } from "@/server/crm/schemas";

import { LeadFilters } from "./_components/lead-filters";
import { LeadsTable } from "./_components/leads-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.leads");
  return { title: t("title") };
}

const firstValues = (raw: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

export default async function LeadsPage({ params, searchParams }: PageProps<"/[locale]/leads">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:read");
  const filters = leadListParams.parse(firstValues(await searchParams));
  const managers = can(ctx.roles, "lead:read_all");
  const result = await listLeads(ctx, filters);
  const owners = managers ? await listLeadOwners(ctx) : null;
  const t = await getTranslations("crm");
  const filtered = Object.values(filters).some((v) => v !== undefined);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("leads.title")}
        description={t("leads.description")}
        actions={
          <>
            <ExportButton
              kind="leads"
              params={{
                q: filters.q,
                stage: filters.stage,
                source: filters.source,
                assignee: filters.assignee,
                duplicates: filters.duplicates,
              }}
            />
            {can(ctx.roles, "lead:merge") ? (
              <Button asChild variant="outline">
                <Link href="/leads/duplicates">
                  <Copy data-icon="inline-start" />
                  {t("duplicates.title")}
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/leads/new">
                <Plus data-icon="inline-start" />
                {t("leads.new")}
              </Link>
            </Button>
          </>
        }
      />
      <LeadFilters owners={owners} />
      <p className="text-sm text-muted-foreground">{t("leads.count", { count: result.total })}</p>
      <LeadsTable
        rows={result.rows}
        showAssignee={managers}
        empty={filtered ? t("leads.emptyFiltered") : t("leads.empty")}
      />
      <Pagination
        pathname="/leads"
        params={{
          q: filters.q,
          stage: filters.stage,
          source: filters.source,
          assignee: filters.assignee,
          duplicates: filters.duplicates,
        }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
