import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { ContractDialog } from "@/components/suppliers/contract-dialog";
import { ContractsTable } from "@/components/suppliers/contracts-table";
import { InvoiceDialog } from "@/components/suppliers/invoice-dialogs";
import { InvoicesTable } from "@/components/suppliers/invoices-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers, yearInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";
import { listAccountChoices } from "@/server/treasury/queries";
import {
  listContractTargets,
  listInvoices,
  listResidenceContracts,
  listSuppliers,
} from "@/server/suppliers/queries";

import { ResidenceNav } from "../_components/residence-nav";

/** `?year=2027` → 2027; anything else → the current Algiers year. */
function parseYear(raw: string | string[] | undefined): number {
  const value = Number(typeof raw === "string" ? raw : NaN);
  return Number.isInteger(value) && value >= 2000 && value <= 2100
    ? value
    : yearInAlgiers(new Date());
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("suppliers.expenses");
  return { title: t("title") };
}

export default async function ResidenceExpensesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/residences/[residenceId]/expenses">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("supplier:read");
  const year = parseYear((await searchParams).year);
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const contracts = await listResidenceContracts(ctx, residenceId);
  const targets = await listContractTargets(ctx);
  const suppliers = await listSuppliers(ctx);
  const invoices = await listInvoices(ctx, { residenceId, year });
  const categories = targets.find((r) => r.id === residenceId)?.categories ?? [];
  const t = await getTranslations("suppliers");
  const tr = await getTranslations("residences");
  const editable = can(ctx.roles, "supplier:update");
  const accounts = editable ? await listAccountChoices(ctx) : [];
  const today = todayInAlgiers();
  const yearHref = (y: number) => `/residences/${residenceId}/expenses?year=${y}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
        actions={<ExportButton kind="invoices" params={{ residence: residenceId, year }} />}
      />
      <ResidenceNav residenceId={residenceId} current="expenses" roles={ctx.roles} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("invoices.title", { year })}</CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={yearHref(year - 1)}>
                <ChevronLeft data-icon="inline-start" className="rtl:rotate-180" />
                {year - 1}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={yearHref(year + 1)}>
                {year + 1}
                <ChevronRight data-icon="inline-end" className="rtl:rotate-180" />
              </Link>
            </Button>
            {editable && suppliers.length > 0 ? (
              <InvoiceDialog
                residenceId={residenceId}
                suppliers={suppliers}
                categories={categories}
                contracts={contracts}
                today={today}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <InvoicesTable
            invoices={invoices}
            show="supplier"
            editable={editable}
            residenceId={residenceId}
            suppliers={suppliers}
            categories={categories}
            contracts={contracts}
            today={today}
            accounts={accounts}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("contracts.title")}</CardTitle>
          {editable && suppliers.length > 0 ? (
            <ContractDialog
              residenceId={residenceId}
              suppliers={suppliers}
              targets={targets}
              today={today}
            />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2">
          {editable && suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("contracts.noSupplier")}</p>
          ) : null}
          <ContractsTable
            contracts={contracts}
            show="supplier"
            editable={editable}
            targets={targets}
            today={today}
          />
        </CardContent>
      </Card>
    </div>
  );
}
