import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { LeaseForm } from "@/components/rentals/lease-form";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { listLeasableUnits } from "@/server/rentals/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rentals");
  return { title: t("newTitle") };
}

/** New lease of a unit the promoter keeps (available, or blocked as kept by the company). */
export default async function NewLeasePage({ params }: PageProps<"/[locale]/rentals/new">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lease:update");
  const units = await listLeasableUnits(ctx);
  const t = await getTranslations("rentals");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("newTitle")} crumbs={[{ label: t("title"), href: "/rentals" }]} />
      {units.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("noUnits")}
        </p>
      ) : (
        <LeaseForm units={units} today={todayInAlgiers()} />
      )}
    </div>
  );
}
