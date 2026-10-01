import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { yearInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getChargesSetup } from "@/server/charges/queries";

import { ResidenceNav } from "../_components/residence-nav";

import { BudgetEditor } from "./_components/budget-editor";
import { CategoriesCard } from "./_components/categories-card";

/** `?year=2027` → 2027; anything else → the current Algiers year. */
function parseYear(raw: string | string[] | undefined): number {
  const value = Number(typeof raw === "string" ? raw : NaN);
  return Number.isInteger(value) && value >= 2000 && value <= 2100
    ? value
    : yearInAlgiers(new Date());
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges");
  return { title: t("title") };
}

export default async function ResidenceChargesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/residences/[residenceId]/charges">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const year = parseYear((await searchParams).year);
  const setup = await getChargesSetup(ctx, residenceId, year);
  if (!setup) notFound();
  const t = await getTranslations("charges");
  const tr = await getTranslations("residences");
  const editable = can(ctx.roles, "charge:create");
  const yearHref = (y: number) => `/residences/${residenceId}/charges?year=${y}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={setup.residence.name}
        description={setup.residence.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="charges" roles={ctx.roles} />
      <CategoriesCard setup={setup} editable={editable} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("budget.title", { year })}</CardTitle>
          <div className="flex items-center gap-1">
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
          </div>
        </CardHeader>
        <CardContent>
          <BudgetEditor
            key={`${year}:${setup.budget?.status ?? "none"}:${setup.lines
              .map((l) => `${l.categoryId}=${l.amount}`)
              .join()}:${setup.categories.map((c) => c.id).join()}`}
            setup={setup}
            year={year}
            editable={editable}
          />
        </CardContent>
      </Card>
    </div>
  );
}
