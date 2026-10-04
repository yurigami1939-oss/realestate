import { Send, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { AssemblyDialog, CloseAssemblyDialog } from "@/components/assemblies/assembly-dialogs";
import { AttendanceSheet } from "@/components/assemblies/attendance-sheet";
import { AssemblyStatusBadge, ResolutionResultBadge } from "@/components/assemblies/badges";
import { ResolutionDialog } from "@/components/assemblies/resolution-dialog";
import { VotesGrid } from "@/components/assemblies/votes-grid";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ChargeDocumentPdf } from "@/components/residences/charge-document-pdf";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { votingKinds } from "@/lib/assemblies";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import {
  conveneAssemblyAction,
  deleteAssemblyAction,
  deleteResolutionAction,
} from "@/server/assemblies/actions";
import { getAssembly } from "@/server/assemblies/queries";
import { requirePermission } from "@/server/auth/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assemblies");
  return { title: t("title") };
}

export default async function AssemblyPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/assemblies/[assemblyId]">) {
  const { locale, residenceId, assemblyId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("assembly:read");
  const assembly = await getAssembly(ctx, residenceId, assemblyId);
  if (!assembly) notFound();
  const t = await getTranslations("assemblies");
  const tr = await getTranslations("residences");
  const tc = await getTranslations("common");
  const today = todayInAlgiers();
  const editable = can(ctx.roles, "assembly:update");
  const { status } = assembly;
  const draft = status === "draft";
  const convened = status === "convened";
  const closed = status === "closed";
  const voters = assembly.sheet.flatMap((u) => (u.kind && votingKinds.includes(u.kind) ? [u] : []));
  const pendingPdf = (!draft && !assembly.convocationFileId) || (closed && !assembly.minutesFileId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("heading", {
          kind: t(`kind.${assembly.kind}`),
          date: formatDate(assembly.heldOn),
        })}
        description={assembly.residenceName}
        crumbs={[
          { label: tr("title"), href: "/residences" },
          { label: assembly.residenceName, href: `/residences/${residenceId}` },
          { label: t("title"), href: `/residences/${residenceId}/assemblies` },
        ]}
        badge={<AssemblyStatusBadge status={status} />}
        actions={
          editable ? (
            <>
              {draft ? (
                <AssemblyDialog residenceId={residenceId} assembly={assembly} today={today} />
              ) : null}
              {draft ? (
                <ConfirmAction
                  action={deleteAssemblyAction}
                  input={{ assemblyId: assembly.id }}
                  label={tc("delete")}
                  icon={<Trash2 data-icon="inline-start" />}
                  title={t("delete.title")}
                  description={t("delete.description")}
                  confirmLabel={tc("delete")}
                  successMessage={t("delete.done")}
                  redirectTo={`/residences/${residenceId}/assemblies`}
                  destructive
                  variant="ghost"
                />
              ) : null}
              {draft && assembly.resolutions.length > 0 ? (
                <ConfirmAction
                  action={conveneAssemblyAction}
                  input={{ assemblyId: assembly.id }}
                  label={t("convene.label")}
                  icon={<Send data-icon="inline-start" className="rtl:rotate-180" />}
                  title={t("convene.title")}
                  description={t("convene.description")}
                  confirmLabel={t("convene.label")}
                  successMessage={t("convene.done")}
                  variant="default"
                />
              ) : null}
              {convened && assembly.attendanceRecorded && assembly.heldOn <= today ? (
                <CloseAssemblyDialog assemblyId={assembly.id} />
              ) : null}
            </>
          ) : null
        }
      />

      <dl className="grid gap-2 text-sm sm:grid-cols-4" data-testid="assembly-details">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("details.when")}</dt>
          <dd className="font-medium">
            {formatDate(assembly.heldOn)}{" "}
            <span dir="ltr">
              {assembly.startTime}
              {assembly.endTime ? ` – ${assembly.endTime}` : ""}
            </span>
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("details.place")}</dt>
          <dd className="font-medium">{assembly.place}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("details.convocation")}</dt>
          <dd>
            {assembly.convenedAt ? (
              <>
                <div className="text-muted-foreground">
                  {t("details.convenedOn", { date: formatDate(assembly.convenedAt) })}
                </div>
                <ChargeDocumentPdf
                  fileId={assembly.convocationFileId}
                  kind="assembly_convocation"
                  id={assembly.id}
                  label={t("pdf.convocation")}
                />
              </>
            ) : (
              <span className="text-muted-foreground">{t("details.notConvened")}</span>
            )}
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("details.minutes")}</dt>
          <dd>
            {assembly.closedAt ? (
              <>
                <div className="text-muted-foreground">
                  {t("details.closedOn", { date: formatDate(assembly.closedAt) })}
                </div>
                <ChargeDocumentPdf
                  fileId={assembly.minutesFileId}
                  kind="assembly_minutes"
                  id={assembly.id}
                  label={t("pdf.minutes")}
                />
              </>
            ) : (
              <span className="text-muted-foreground">{t("details.notClosed")}</span>
            )}
          </dd>
        </div>
      </dl>

      {closed ? (
        <p className="text-sm" data-testid="assembly-bureau">
          {t("details.bureau", {
            chair: assembly.chairName ?? "—",
            secretary: assembly.secretaryName ?? "—",
          })}
        </p>
      ) : null}
      {draft ? (
        <Alert>
          <AlertDescription>{t("draftNotice")}</AlertDescription>
        </Alert>
      ) : null}
      {convened && editable && assembly.heldOn > today ? (
        <Alert>
          <AlertDescription>
            {t("notHeldNotice", { date: formatDate(assembly.heldOn) })}
          </AlertDescription>
        </Alert>
      ) : null}
      {assembly.notes ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{assembly.notes}</p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("agenda.title")}</CardTitle>
          {draft && editable ? <ResolutionDialog assemblyId={assembly.id} /> : null}
        </CardHeader>
        <CardContent>
          {assembly.resolutions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("agenda.empty")}</p>
          ) : (
            <ol className="space-y-4" data-testid="agenda">
              {assembly.resolutions.map((r) => (
                <li key={r.id} className="border-s-2 ps-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-medium">
                        {t("agenda.number", { position: r.position })} · {r.title}
                      </div>
                      {r.titleAr ? (
                        <div dir="rtl" lang="ar" className="w-fit">
                          {r.titleAr}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground">
                        {t(`majority.${r.majority}`)}
                      </div>
                    </div>
                    {closed && r.adopted !== null ? (
                      <div className="flex flex-col items-end gap-1 text-xs">
                        <ResolutionResultBadge adopted={r.adopted} />
                        <span className="text-muted-foreground tabular-nums">
                          {t("votes.tally", {
                            yes: r.sharesFor ?? 0,
                            no: r.sharesAgainst ?? 0,
                            abstain: r.sharesAbstain ?? 0,
                          })}
                        </span>
                      </div>
                    ) : null}
                    {draft && editable ? (
                      <div className="flex gap-1">
                        <ResolutionDialog assemblyId={assembly.id} resolution={r} />
                        <ConfirmAction
                          action={deleteResolutionAction}
                          input={{ resolutionId: r.id }}
                          label={t("agenda.remove")}
                          icon={<Trash2 data-icon="inline-start" />}
                          title={t("agenda.deleteTitle")}
                          description={t("agenda.deleteDescription")}
                          confirmLabel={t("agenda.remove")}
                          successMessage={t("agenda.deleted")}
                          destructive
                          variant="ghost"
                        />
                      </div>
                    ) : null}
                  </div>
                  {r.description ? (
                    <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
                      {r.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {draft ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("attendance.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("attendance.description")}</p>
          </CardHeader>
          <CardContent>
            <AttendanceSheet
              key={assembly.sheet.map((u) => `${u.kind}:${u.proxyName}`).join()}
              assemblyId={assembly.id}
              sheet={assembly.sheet}
              editable={editable && convened}
            />
          </CardContent>
        </Card>
      )}

      {draft ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("votes.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {assembly.attendanceRecorded ? (
              <VotesGrid
                key={`${voters.map((v) => v.unitId).join()}:${assembly.votes.length}`}
                assemblyId={assembly.id}
                resolutions={assembly.resolutions}
                voters={voters}
                votes={assembly.votes}
                totalShares={assembly.shares}
                editable={editable && convened}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("votes.needAttendance")}</p>
            )}
          </CardContent>
        </Card>
      )}
      <PendingDocumentsRefresher pending={pendingPdf} />
    </div>
  );
}
