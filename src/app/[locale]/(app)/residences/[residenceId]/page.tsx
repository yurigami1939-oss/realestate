import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence, listUnitResidents } from "@/server/residences/queries";

import { SharesEditor } from "./_components/shares-editor";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/residences/[residenceId]">): Promise<Metadata> {
  const ctx = await requirePermission("residence:read");
  const residence = await getResidence(ctx, (await params).residenceId);
  return { title: residence?.name };
}

export default async function ResidencePage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("residence:read");
  const residence = await getResidence(ctx, residenceId);
  if (!residence) notFound();
  const history = await listUnitResidents(
    ctx,
    residence.id,
    residence.units.map((u) => u.unitId),
  );
  const t = await getTranslations("residences");
  const tc = await getTranslations("common");
  const editable = can(ctx.roles, "residence:update");
  const place = [residence.address, residence.commune, residence.wilaya].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={residence.name}
        description={[residence.projectName, place].filter(Boolean).join(" · ")}
        crumbs={[{ label: t("title"), href: "/residences" }]}
        actions={
          editable ? (
            <Button asChild variant="outline">
              <Link href={`/residences/${residence.id}/edit`}>
                <Pencil data-icon="inline-start" />
                {tc("edit")}
              </Link>
            </Button>
          ) : null
        }
      />
      <dl className="grid gap-2 text-sm sm:grid-cols-4" data-testid="residence-settings">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.chargeFrequency")}</dt>
          <dd className="font-medium">{t(`frequency.${residence.chargeFrequency}`)}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.reserveFund")}</dt>
          <dd className="font-medium" dir="ltr">
            {formatShare(residence.reserveFundBp)}
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.callDueDays")}</dt>
          <dd className="font-medium">{t("days", { days: residence.callDueDays })}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.shareBasis")}</dt>
          <dd className="font-medium tabular-nums" dir="ltr">
            {residence.shareBasis}
          </dd>
        </div>
      </dl>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("units.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SharesEditor
            key={residence.units.map((u) => u.share).join()}
            residence={residence}
            history={history}
            editable={editable}
            today={todayInAlgiers()}
          />
        </CardContent>
      </Card>
      {residence.notes ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{residence.notes}</p>
      ) : null}
    </div>
  );
}
