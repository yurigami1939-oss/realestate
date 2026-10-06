import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import {
  ArchiveCheckButton,
  CheckDialog,
  VisitDialog,
  VisitScan,
} from "@/components/maintenance/check-dialogs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import type { CheckState } from "@/lib/maintenance";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listChecks } from "@/server/maintenance/service";
import { getResidence } from "@/server/residences/queries";
import { listSuppliers } from "@/server/suppliers/queries";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("maintenance");
  return { title: t("title") };
}

const stateClass: Record<CheckState, string> = {
  overdue: "text-red-800",
  due_soon: "text-amber-800",
  ok: "text-emerald-800",
};

/**
 * Contrôles et entretiens of a residence: its insurance, regulatory inspections and preventive
 * maintenance by next deadline (late or coming first), each with its latest visits and their
 * certificates.
 */
export default async function ResidenceChecksPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/checks">) {
  const { locale: raw, residenceId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("residence:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const checks = await listChecks(ctx, { residenceId });
  const editable = can(ctx.roles, "residence:update");
  const suppliers = editable
    ? (await listSuppliers(ctx)).map((s) => ({ id: s.id, name: s.name }))
    : [];
  const t = await getTranslations("maintenance");
  const tr = await getTranslations("residences");
  const today = todayInAlgiers();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
        actions={
          editable ? (
            <CheckDialog residenceId={residenceId} suppliers={suppliers} today={today} />
          ) : null
        }
      />
      <ResidenceNav residenceId={residenceId} current="checks" roles={ctx.roles} />
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-3" data-testid="residence-checks">
          {checks.map((check) => (
            <li key={check.id} data-check={check.title} data-state={check.state ?? undefined}>
              <Card>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {check.title}
                        <span className="ms-2 text-xs text-muted-foreground">
                          {t(`kind.${check.kind}`)} · {t(`category.${check.category}`)}
                        </span>
                      </p>
                      <p className="text-sm">
                        {check.state ? (
                          <Badge variant="outline" className={stateClass[check.state]}>
                            {t(`state.${check.state}`)}
                          </Badge>
                        ) : null}{" "}
                        <span className="tabular-nums" dir="ltr">
                          {formatDate(check.nextDueOn)}
                        </span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {check.frequencyMonths
                            ? t("everyMonths", { count: check.frequencyMonths })
                            : t("oneOff")}
                          {check.supplierName ? ` · ${check.supplierName}` : ""}
                          {check.reference ? (
                            <>
                              {" · "}
                              <bdi dir="ltr">{check.reference}</bdi>
                            </>
                          ) : null}
                        </span>
                      </p>
                      {check.notes ? (
                        <p className="text-xs whitespace-pre-line text-muted-foreground">
                          {check.notes}
                        </p>
                      ) : null}
                    </div>
                    {editable ? (
                      <div className="flex items-center gap-1">
                        <VisitDialog
                          checkId={check.id}
                          frequencyMonths={check.frequencyMonths}
                          supplierId={check.supplierId}
                          suppliers={suppliers}
                          today={today}
                        />
                        <CheckDialog
                          residenceId={residenceId}
                          checkId={check.id}
                          suppliers={suppliers}
                          today={today}
                          values={{
                            kind: check.kind,
                            category: check.category,
                            title: check.title,
                            supplierId: check.supplierId ?? "",
                            frequencyMonths: check.frequencyMonths
                              ? String(check.frequencyMonths)
                              : "",
                            nextDueOn: check.nextDueOn,
                            reference: check.reference ?? "",
                            notes: check.notes ?? "",
                          }}
                        />
                        <ArchiveCheckButton checkId={check.id} />
                      </div>
                    ) : null}
                  </div>
                  {check.visits.length > 0 ? (
                    <ul className="divide-y border-t text-sm" data-testid="check-visits">
                      {check.visits.map((visit) => (
                        <li
                          key={visit.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2"
                        >
                          <span>
                            <span className="tabular-nums" dir="ltr">
                              {formatDate(visit.doneOn)}
                            </span>
                            {" · "}
                            {t(`result.${visit.result}`)}
                            {visit.supplierName ? ` · ${visit.supplierName}` : ""}
                            {visit.cost !== null ? (
                              <span className="tabular-nums" dir="ltr">
                                {" · "}
                                {formatDZD(visit.cost, locale)}
                              </span>
                            ) : null}
                            {visit.notes ? (
                              <span className="block text-xs text-muted-foreground">
                                {visit.notes}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs">
                            <VisitScan
                              visitId={visit.id}
                              fileId={visit.scanFileId}
                              editable={editable}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
