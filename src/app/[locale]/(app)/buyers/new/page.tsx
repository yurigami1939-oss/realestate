import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { requirePermission } from "@/server/auth/page-guard";
import { getLead } from "@/server/crm/queries";

import { BuyerForm, emptyBuyer } from "../_components/buyer-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("buyers");
  return { title: t("newTitle") };
}

/** "Karim Ben Salem" → first name "Karim Ben", last name "Salem" (to be checked by the user). */
function splitName(fullName: string) {
  const words = fullName.trim().split(/\s+/);
  if (words.length < 2) return { firstName: "", lastName: fullName.trim() };
  return { firstName: words.slice(0, -1).join(" "), lastName: words.at(-1) ?? "" };
}

export default async function NewBuyerPage({
  params,
  searchParams,
}: PageProps<"/[locale]/buyers/new">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("buyer:create");
  const leadId = (await searchParams).leadId;
  const lead =
    typeof leadId === "string" && can(ctx.roles, "lead:read") ? await getLead(ctx, leadId) : null;
  const t = await getTranslations("buyers");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("newTitle")} crumbs={[{ label: t("title"), href: "/buyers" }]} />
      <BuyerForm
        defaultValues={
          lead
            ? {
                ...emptyBuyer,
                ...splitName(lead.fullName),
                phone: formatPhone(lead.phone),
                phone2: lead.phone2 ? formatPhone(lead.phone2) : "",
                email: lead.email ?? "",
                commune: lead.city ?? "",
                leadId: lead.id,
              }
            : emptyBuyer
        }
      />
    </div>
  );
}
