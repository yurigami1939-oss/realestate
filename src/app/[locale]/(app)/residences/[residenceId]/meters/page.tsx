import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { MeterReadingsForm } from "@/components/residences/meter-readings-form";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getMeterBoard } from "@/server/charges/meters";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.meters");
  return { title: t("title") };
}

/** m³ with three decimals at most, French style ("12,5"). */
function cubicMetres(litres: bigint): string {
  const whole = litres / 1000n;
  const fraction = (litres % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `,${fraction}` : ""}`;
}

/**
 * Water meters of a residence: each unit's two latest readings and the consumption between
 * them (what a `consumption` category splits by), and a new reading campaign.
 */
export default async function ResidenceMetersPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/meters">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const board = await getMeterBoard(ctx, residenceId);
  if (!board) notFound();
  const t = await getTranslations("charges.meters");
  const tr = await getTranslations("residences");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={board.residence.name}
        description={t("title")}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="meters" roles={ctx.roles} />
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <MeterReadingsForm
        residenceId={residenceId}
        today={todayInAlgiers()}
        editable={can(ctx.roles, "charge:create")}
        rows={board.units.map((u) => ({
          unitId: u.unitId,
          code: u.code,
          last: u.last ? { readOn: u.last.readOn, reading: u.last.reading } : null,
          previous: u.previous ? { readOn: u.previous.readOn, reading: u.previous.reading } : null,
          consumption:
            u.consumption === null ? null : t("cubicMetres", { value: cubicMetres(u.consumption) }),
        }))}
      />
    </div>
  );
}
