import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ContractDialog } from "@/components/suppliers/contract-dialog";
import { ContractsTable } from "@/components/suppliers/contracts-table";
import { InvoicesTable } from "@/components/suppliers/invoices-table";
import { SupplierDialog } from "@/components/suppliers/supplier-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { deleteSupplierAction } from "@/server/suppliers/actions";
import { getSupplier, listContractTargets, listInvoices } from "@/server/suppliers/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/suppliers/[supplierId]">): Promise<Metadata> {
  const ctx = await requirePermission("supplier:read");
  const supplier = await getSupplier(ctx, (await params).supplierId);
  return { title: supplier?.name };
}

export default async function SupplierPage({
  params,
}: PageProps<"/[locale]/suppliers/[supplierId]">) {
  const { locale, supplierId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("supplier:read");
  const supplier = await getSupplier(ctx, supplierId);
  if (!supplier) notFound();
  const targets = await listContractTargets(ctx);
  const invoices = await listInvoices(ctx, { supplierId: supplier.id });
  const t = await getTranslations("suppliers");
  const editable = can(ctx.roles, "supplier:update");
  const today = todayInAlgiers();
  const details = [
    { key: "phone", value: supplier.phone },
    { key: "email", value: supplier.email },
    { key: "address", value: supplier.address },
    { key: "nif", value: supplier.nif },
    { key: "rcNumber", value: supplier.rcNumber },
    { key: "rib", value: supplier.rib },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={supplier.name}
        description={supplier.activity ?? undefined}
        crumbs={[{ label: t("title"), href: "/suppliers" }]}
        actions={
          editable ? (
            <>
              <SupplierDialog supplier={supplier} />
              <ConfirmAction
                action={deleteSupplierAction}
                input={{ supplierId: supplier.id }}
                label={t("delete")}
                icon={<Trash2 data-icon="inline-start" />}
                destructive
                title={t("deleteTitle", { name: supplier.name })}
                description={t("deleteDescription")}
                confirmLabel={t("delete")}
                successMessage={t("deleted")}
                redirectTo="/suppliers"
              />
            </>
          ) : null
        }
      />
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {details.map((d) => (
          <div key={d.key} className="rounded-md border p-2">
            <dt className="text-muted-foreground">{t(`fields.${d.key}`)}</dt>
            <dd className="font-medium break-words">
              {d.value === null ? (
                "—"
              ) : d.key === "phone" ? (
                <PhoneText value={d.value} />
              ) : d.key === "address" ? (
                d.value
              ) : (
                <bdi dir="ltr">{d.value}</bdi>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {supplier.notes ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{supplier.notes}</p>
      ) : null}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("contracts.title")}</CardTitle>
          {editable && targets.length > 0 ? (
            <ContractDialog supplierId={supplier.id} targets={targets} today={today} />
          ) : null}
        </CardHeader>
        <CardContent>
          <ContractsTable
            contracts={supplier.contracts}
            show="residence"
            editable={editable}
            targets={targets}
            today={today}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("invoices.all")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicesTable invoices={invoices} show="residence" editable={editable} today={today} />
        </CardContent>
      </Card>
    </div>
  );
}
