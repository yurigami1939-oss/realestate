import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { toLocale } from "@/i18n/locales";
import { SATIM_HELP_NUMBER } from "@/lib/online-payments";
import { getPortalCompany } from "@/server/online-payments/queries";
import { requirePortalCtx } from "@/server/portal/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.pay.termsPage");
  return { title: t("title") };
}

const paragraphs = ["gateway", "allocation", "currency", "failure", "card", "data"] as const;

/** The conditions the payer accepts before paying online (CLAUDE.md §7 Online payment). */
export default async function PaymentTermsPage({
  params,
}: PageProps<"/[locale]/portal/payment-terms">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePortalCtx();
  const company = await getPortalCompany(ctx);
  const t = await getTranslations("portal.pay.termsPage");
  const values = {
    company: company.name,
    contact: company.phone ? ` (${company.phone})` : "",
    number: SATIM_HELP_NUMBER,
  };

  return (
    <article className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {paragraphs.map((key) => (
        <p key={key} className="leading-relaxed">
          {t(key, values)}
        </p>
      ))}
    </article>
  );
}
