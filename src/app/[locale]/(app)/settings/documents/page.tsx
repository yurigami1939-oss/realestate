import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { DocumentTextsForm } from "@/components/settings/document-texts-form";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";
import { getCompanySettings } from "@/server/organizations/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documentTexts");
  return { title: t("title") };
}

/**
 * The organization's own wording on its documents (CLAUDE.md §7 Documents): a paragraph in
 * French and in Arabic per kind, printed on the documents issued afterwards.
 */
export default async function DocumentTextsPage({
  params,
}: PageProps<"/[locale]/settings/documents">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const company = await getCompanySettings(ctx);
  const t = await getTranslations("documentTexts");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <DocumentTextsForm current={company.documentTexts} />
    </div>
  );
}
