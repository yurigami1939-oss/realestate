import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ContractDialog } from "@/components/suppliers/contract-dialog";
import { ContractsTable } from "@/components/suppliers/contracts-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";
import {
  listContractTargets,
  listResidenceContracts,
  listSuppliers,
} from "@/server/suppliers/queries";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("suppliers.expenses");
  return { title: t("title") };
}

export default async function ResidenceExpensesPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/expenses">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("supplier:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const contracts = await listResidenceContracts(ctx, residenceId);
  const targets = await listContractTargets(ctx);
  const suppliers = await listSuppliers(ctx);
  const t = await getTranslations("suppliers");
  const tr = await getTranslations("residences");
  const editable = can(ctx.roles, "supplier:update");
  const today = todayInAlgiers();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="expenses" roles={ctx.roles} />
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
