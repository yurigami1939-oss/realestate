import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { UnitStatusBadge, useFloorLabel } from "@/components/inventory/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { pricePerSquareMeter } from "@/lib/inventory";
import { formatDZD, toDecimalString } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listLeadChoices } from "@/server/crm/queries";
import { getSalesSettings } from "@/server/organizations/settings";
import { getUnitOption } from "@/server/sales/queries";
import { deleteUnitAction } from "@/server/inventory/actions";
import { getUnit, type UnitDetail } from "@/server/inventory/queries";

import { FloorPlanCard } from "./_components/floor-plan-card";
import { UnitSaleCard } from "./_components/unit-sale-card";
import { BlockUnitDialog, ChangePriceDialog } from "./_components/unit-dialogs";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/projects/[projectId]/units/[unitId]">): Promise<Metadata> {
  const ctx = await requirePermission("inventory:read");
  const unit = await getUnit(ctx, (await params).unitId);
  return { title: unit?.code };
}

export default async function UnitPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/units/[unitId]">) {
  const { locale, projectId, unitId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("inventory:read");
  const unit = await getUnit(ctx, unitId);
  if (!unit || unit.projectId !== projectId) notFound();

  const canSell = can(ctx.roles, "sale:create");
  const option = unit.status === "optioned" ? await getUnitOption(ctx, unit.id) : null;
  const leads = canSell && unit.status === "available" ? await listLeadChoices(ctx) : [];
  const { optionHours } = await getSalesSettings(ctx);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const deletable = unit.status === "available" || unit.status === "blocked";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={unit.code}
        badge={<UnitStatusBadge status={unit.status} />}
        crumbs={[
          { label: t("projects.title"), href: "/projects" },
          { label: unit.projectName, href: `/projects/${projectId}` },
          { label: unit.buildingName, href: `/projects/${projectId}/buildings/${unit.buildingId}` },
        ]}
        actions={
          <>
            {can(ctx.roles, "unit:update") ? (
              <Button asChild variant="outline">
                <Link href={`/projects/${projectId}/units/${unit.id}/edit`}>
                  <Pencil data-icon="inline-start" />
                  {tc("edit")}
                </Link>
              </Button>
            ) : null}
            {can(ctx.roles, "price:update") ? (
              <ChangePriceDialog
                unitId={unit.id}
                code={unit.code}
                currentPrice={
                  unit.listPrice !== null ? toDecimalString(unit.listPrice).replace(".", ",") : ""
                }
              />
            ) : null}
            {can(ctx.roles, "unit:block") &&
            (unit.status === "available" || unit.status === "blocked") ? (
              <BlockUnitDialog
                unitId={unit.id}
                code={unit.code}
                blocked={unit.status === "blocked"}
              />
            ) : null}
            {can(ctx.roles, "unit:delete") && deletable ? (
              <ConfirmAction
                action={deleteUnitAction}
                input={{ unitId: unit.id }}
                label={tc("delete")}
                icon={<Trash2 data-icon="inline-start" />}
                title={t("units.deleteTitle", { code: unit.code })}
                description={t("units.deleteDescription")}
                confirmLabel={tc("delete")}
                successMessage={t("units.deleted")}
                redirectTo={`/projects/${projectId}/buildings/${unit.buildingId}`}
                destructive
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <UnitDetails unit={unit} />
        <div className="space-y-6">
          <PriceCard unit={unit} />
          <UnitSaleCard
            unitId={unit.id}
            code={unit.code}
            status={unit.status}
            option={option}
            leads={leads}
            optionHours={optionHours}
            canSell={canSell}
          />
          <FloorPlanCard
            unitId={unit.id}
            code={unit.code}
            plan={unit.floorPlan}
            editable={can(ctx.roles, "unit:update")}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusHistory unit={unit} />
        <PriceHistory unit={unit} />
      </div>
    </div>
  );
}

function UnitDetails({ unit }: { unit: UnitDetail }) {
  const t = useTranslations("inventory");
  const floorLabel = useFloorLabel();
  const area = (v: string | null) => (v ? `${v.replace(".", ",")} m²` : null);
  const rows: [string, string | null][] = [
    [t("units.fields.building"), unit.buildingName],
    [t("units.fields.floor"), floorLabel(unit.floor)],
    [t("units.fields.type"), t(`unitType.${unit.type}`)],
    [
      t("units.fields.typology"),
      [unit.typology, unit.isDuplex ? t("units.fields.isDuplex") : null]
        .filter(Boolean)
        .join(" · ") || null,
    ],
    [t("units.fields.livingArea"), area(unit.livingArea)],
    [t("units.fields.usableArea"), area(unit.usableArea)],
    [t("units.fields.outdoorArea"), area(unit.outdoorArea)],
    [
      t("units.fields.orientations"),
      unit.orientations.map((o) => t(`orientation.${o}`)).join(", ") || null,
    ],
    [t("units.fields.share"), unit.share !== null ? String(unit.share) : null],
  ];
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">{t("units.details")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-end font-medium">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {unit.notes ? (
          <p className="whitespace-pre-line text-muted-foreground">{unit.notes}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PriceCard({ unit }: { unit: UnitDetail }) {
  const t = useTranslations("inventory.units");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const perSqm =
    unit.listPrice !== null ? pricePerSquareMeter(unit.listPrice, unit.livingArea) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("fields.listPrice")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold" dir="ltr" data-testid="unit-price">
          {unit.listPrice !== null ? formatDZD(unit.listPrice, locale) : t("noPrice")}
        </p>
        {perSqm !== null ? (
          <p className="text-sm text-muted-foreground">
            {t("pricePerSqm", { price: formatDZD(perSqm, locale) })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusHistory({ unit }: { unit: UnitDetail }) {
  const t = useTranslations("inventory.units");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("statusHistory")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("historyColumns.date")}</TableHead>
              <TableHead>{t("historyColumns.change")}</TableHead>
              <TableHead>{t("historyColumns.reason")}</TableHead>
              <TableHead>{t("historyColumns.by")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unit.statusHistory.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(h.createdAt)}</TableCell>
                <TableCell>
                  {h.fromStatus ? (
                    <span className="flex items-center gap-1">
                      <UnitStatusBadge status={h.fromStatus} />
                      <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                      <UnitStatusBadge status={h.toStatus} />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      {t("createdEvent")} <UnitStatusBadge status={h.toStatus} />
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal">{h.reason ?? "—"}</TableCell>
                <TableCell>{h.actorName ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PriceHistory({ unit }: { unit: UnitDetail }) {
  const t = useTranslations("inventory.units");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint | null) => (v !== null ? formatDZD(v, locale) : "—");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("priceHistory")}</CardTitle>
      </CardHeader>
      <CardContent>
        {unit.priceHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("historyColumns.date")}</TableHead>
                <TableHead>{t("historyColumns.change")}</TableHead>
                <TableHead>{t("historyColumns.reason")}</TableHead>
                <TableHead>{t("historyColumns.by")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unit.priceHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(h.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap" dir="ltr">
                    {money(h.oldPrice)} → {money(h.newPrice)}
                  </TableCell>
                  <TableCell className="max-w-48 whitespace-normal">
                    {h.priceListVersion !== null
                      ? t("priceListRef", { version: h.priceListVersion })
                      : (h.reason ?? "—")}
                  </TableCell>
                  <TableCell>{h.actorName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
