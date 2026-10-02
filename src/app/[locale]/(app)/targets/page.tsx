import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { addMonths, todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { monthText } from "@/server/crm/schemas";
import { getTargetProgress } from "@/server/crm/targets";

import { TargetsTable } from "./_components/targets-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("targets");
  return { title: t("title") };
}

export default async function TargetsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/targets">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePermission("lead:read");
  const requested = monthText().safeParse((await searchParams).month);
  const month = requested.success ? requested.data : todayInAlgiers().slice(0, 7);
  const rows = await getTargetProgress(ctx, month);
  const t = await getTranslations("targets");
  const shift = (months: number) => addMonths(`${month}-01`, months).slice(0, 7);
  const label = new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon">
              <Link
                href={{ pathname: "/targets", query: { month: shift(-1) } }}
                aria-label={t("previous")}
              >
                <ChevronLeft className="rtl:rotate-180" />
              </Link>
            </Button>
            <span
              className="min-w-36 text-center font-medium capitalize"
              data-testid="targets-month"
            >
              {label}
            </span>
            <Button asChild variant="outline" size="icon">
              <Link
                href={{ pathname: "/targets", query: { month: shift(1) } }}
                aria-label={t("next")}
              >
                <ChevronRight className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        }
      />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <TargetsTable
          key={month}
          month={month}
          rows={rows}
          editable={can(ctx.roles, "target:update")}
        />
      )}
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
    </div>
  );
}
