import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { formatAmountInput } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { requirePermission } from "@/server/auth/page-guard";
import { getLead } from "@/server/crm/queries";
import { listProjectOptions } from "@/server/inventory/queries";
import { listPartnerChoices } from "@/server/partners/service";

import { LeadForm } from "../../_components/lead-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.leads");
  return { title: t("editTitle") };
}

export default async function EditLeadPage({ params }: PageProps<"/[locale]/leads/[leadId]/edit">) {
  const { locale, leadId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("lead:update");
  const lead = await getLead(ctx, leadId);
  if (!lead) notFound();
  const projects = await listProjectOptions(ctx);
  const t = await getTranslations("crm.leads");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("editTitle")}
        crumbs={[
          { label: t("title"), href: "/leads" },
          { label: lead.fullName, href: `/leads/${lead.id}` },
        ]}
      />
      <LeadForm
        leadId={lead.id}
        projects={projects}
        owners={null}
        defaultValues={{
          fullName: lead.fullName,
          phone: formatPhone(lead.phone),
          phone2: lead.phone2 ? formatPhone(lead.phone2) : "",
          email: lead.email ?? "",
          city: lead.city ?? "",
          source: lead.source,
          sourceDetail: lead.sourceDetail ?? "",
          projectId: lead.projectId ?? "",
          typologies: lead.typologies,
          budget: lead.budget !== null ? formatAmountInput(lead.budget) : "",
          financing: lead.financing ?? "",
          notes: lead.notes ?? "",
          assignedTo: "",
          partnerId: lead.partnerId ?? "",
        }}
        partners={await listPartnerChoices(ctx)}
      />
    </div>
  );
}
