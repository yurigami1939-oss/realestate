import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getLead } from "@/server/crm/queries";
import { listProjectOptions, listUnitOptions } from "@/server/inventory/queries";
import { listPaymentSetups } from "@/server/payment-plans/queries";

import { QuotationForm, type QuotableUnit } from "./_components/quotation-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotations");
  return { title: t("new") };
}

export default async function NewQuotationPage({
  params,
}: PageProps<"/[locale]/leads/[leadId]/quotations/new">) {
  const { locale, leadId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("quotation:create");
  const lead = await getLead(ctx, leadId);
  if (!lead) notFound();
  const projects = await listProjectOptions(ctx);
  const units: QuotableUnit[] = (await listUnitOptions(ctx)).flatMap((u) =>
    (u.status === "available" || u.status === "optioned") && u.listPrice !== null
      ? [
          {
            id: u.id,
            projectId: u.projectId,
            code: u.code,
            typology: u.typology,
            listPrice: u.listPrice,
          },
        ]
      : [],
  );
  const setups = await listPaymentSetups(ctx);
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("quotations.newTitle", { name: lead.fullName })}
        crumbs={[
          { label: t("crm.leads.title"), href: "/leads" },
          { label: lead.fullName, href: `/leads/${lead.id}` },
        ]}
      />
      <QuotationForm
        leadId={lead.id}
        defaultProjectId={lead.projectId}
        projects={projects}
        units={units}
        setups={setups}
        canDiscount={can(ctx.roles, "quotation:discount")}
      />
    </div>
  );
}
