import { AlertTriangle, FileText, Pencil, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { LeadStageBadge, VisitStatusBadge } from "@/components/crm/badges";
import { PhoneActions, PhoneText } from "@/components/crm/phone";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { quotationState } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import type { TenantCtx } from "@/server/auth/session";
import { deleteLeadAction, mergeLeadsAction } from "@/server/crm/actions";
import { getLead, listLeadOwners, type LeadDetail } from "@/server/crm/queries";
import { listProjectOptions, listUnitOptions } from "@/server/inventory/queries";
import { listLeadQuotations } from "@/server/quotations/queries";

import {
  CompleteFollowUpDialog,
  NewFollowUpDialog,
  RecordVisitDialog,
  ScheduleVisitDialog,
  type UnitChoice,
} from "@/components/crm/activity-dialogs";
import { AssignDialog, StageDialog } from "./_components/lead-dialogs";
import { NoteForm } from "./_components/note-form";
import { Timeline } from "./_components/timeline";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/leads/[leadId]">): Promise<Metadata> {
  const ctx = await requirePermission("lead:read");
  const lead = await getLead(ctx, (await params).leadId);
  return { title: lead?.fullName };
}

type Option = { id: string; name: string };

export default async function LeadPage({ params }: PageProps<"/[locale]/leads/[leadId]">) {
  const { locale, leadId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("lead:read");
  const lead = await getLead(ctx, leadId);
  if (!lead) notFound();

  const managers = can(ctx.roles, "lead:assign");
  const owners = managers ? await listLeadOwners(ctx) : null;
  const projects = await listProjectOptions(ctx);
  const units: UnitChoice[] = (await listUnitOptions(ctx)).map((u) => ({
    id: u.id,
    projectId: u.projectId,
    code: u.code,
    typology: u.typology,
  }));
  const quotations = await listLeadQuotations(ctx, lead.id);
  const t = await getTranslations("crm");
  const tc = await getTranslations("common");
  const editable = can(ctx.roles, "lead:update");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={lead.fullName}
        badge={<LeadStageBadge stage={lead.stage} />}
        crumbs={[{ label: t("leads.title"), href: "/leads" }]}
        actions={
          <>
            {editable ? (
              <Button asChild variant="outline">
                <Link href={`/leads/${lead.id}/edit`}>
                  <Pencil data-icon="inline-start" />
                  {tc("edit")}
                </Link>
              </Button>
            ) : null}
            {editable ? (
              <StageDialog leadId={lead.id} name={lead.fullName} stage={lead.stage} />
            ) : null}
            {owners ? (
              <AssignDialog
                leadId={lead.id}
                name={lead.fullName}
                assignedTo={lead.assignedTo}
                owners={owners}
              />
            ) : null}
            {can(ctx.roles, "lead:delete") ? (
              <ConfirmAction
                action={deleteLeadAction}
                input={{ leadId: lead.id }}
                label={tc("delete")}
                icon={<Trash2 data-icon="inline-start" />}
                title={t("leads.deleteTitle", { name: lead.fullName })}
                description={t("leads.deleteDescription")}
                confirmLabel={tc("delete")}
                successMessage={t("leads.deleted")}
                redirectTo="/leads"
                variant="ghost"
                destructive
              />
            ) : null}
          </>
        }
      />

      {lead.duplicateCount > 0 ? <Duplicates lead={lead} ctx={ctx} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-6 md:grid-cols-2">
            <ContactCard lead={lead} />
            <InterestCard lead={lead} />
          </div>
          <QuotationsCard
            leadId={lead.id}
            quotations={quotations}
            canCreate={can(ctx.roles, "quotation:create")}
          />
          <FollowUpsCard lead={lead} owners={owners} editable={editable} />
          <VisitsCard
            lead={lead}
            owners={owners}
            projects={projects}
            units={units}
            editable={editable}
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("leads.timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {editable ? <NoteForm leadId={lead.id} /> : null}
            <Timeline activities={lead.activities} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-b pb-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-end font-medium">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ContactCard({ lead }: { lead: LeadDetail }) {
  const t = useTranslations("crm");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("leads.sections.contact")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PhoneActions value={lead.phone} />
        <Rows
          rows={[
            [t("leads.fields.phone2"), lead.phone2 ? <PhoneText value={lead.phone2} /> : null],
            [
              t("leads.fields.email"),
              lead.email ? (
                <a href={`mailto:${lead.email}`} dir="ltr" className="hover:underline">
                  {lead.email}
                </a>
              ) : null,
            ],
            [t("leads.fields.city"), lead.city],
            [
              t("leads.fields.source"),
              [t(`source.${lead.source}`), lead.sourceDetail].filter(Boolean).join(" · "),
            ],
            [t("leads.fields.assignedTo"), lead.assigneeName ?? t("leads.unassigned")],
            [t("leads.columns.lastActivity"), formatDateTime(lead.lastActivityAt)],
          ]}
        />
      </CardContent>
    </Card>
  );
}

function InterestCard({ lead }: { lead: LeadDetail }) {
  const t = useTranslations("crm");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("leads.sections.interest")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Rows
          rows={[
            [t("leads.fields.projectId"), lead.projectName],
            [t("leads.fields.typologies"), lead.typologies.join(", ") || null],
            [
              t("leads.fields.budget"),
              lead.budget !== null ? <bdi dir="ltr">{formatDZD(lead.budget, locale)}</bdi> : null,
            ],
            [t("leads.fields.financing"), lead.financing ? t(`financing.${lead.financing}`) : null],
          ]}
        />
        {lead.notes ? (
          <p className="text-sm whitespace-pre-line text-muted-foreground">{lead.notes}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FollowUpsCard({
  lead,
  owners,
  editable,
}: {
  lead: LeadDetail;
  owners: Option[] | null;
  editable: boolean;
}) {
  const t = useTranslations("crm");
  return (
    <Card data-testid="lead-follow-ups">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("followUps.title")}</CardTitle>
        {editable ? <NewFollowUpDialog leadId={lead.id} owners={owners} /> : null}
      </CardHeader>
      <CardContent>
        {lead.followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("followUps.none")}</p>
        ) : (
          <ul className="divide-y">
            {lead.followUps.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p
                    className={cn(
                      "font-medium",
                      f.overdue && "text-rose-700",
                      f.doneAt && "text-muted-foreground line-through",
                    )}
                  >
                    {formatDateTime(f.dueAt)} · {t(`channel.${f.channel}`)}
                    {f.assigneeName ? ` · ${f.assigneeName}` : ""}
                  </p>
                  {f.note ? <p className="text-muted-foreground">{f.note}</p> : null}
                  {f.doneAt ? (
                    <p className="text-xs text-muted-foreground">
                      {t("followUps.doneOn", { date: formatDateTime(f.doneAt) })}
                      {f.outcome ? ` · ${f.outcome}` : ""}
                    </p>
                  ) : null}
                </div>
                {editable && !f.doneAt ? <CompleteFollowUpDialog followUpId={f.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function VisitsCard({
  lead,
  owners,
  projects,
  units,
  editable,
}: {
  lead: LeadDetail;
  owners: Option[] | null;
  projects: Option[];
  units: UnitChoice[];
  editable: boolean;
}) {
  const t = useTranslations("crm");
  return (
    <Card data-testid="lead-visits">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("visits.title")}</CardTitle>
        {editable ? (
          <ScheduleVisitDialog
            leadId={lead.id}
            projectId={lead.projectId}
            projects={projects}
            units={units}
            owners={owners}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {lead.visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("visits.none")}</p>
        ) : (
          <ul className="divide-y">
            {lead.visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {formatDateTime(v.scheduledAt)}
                    <VisitStatusBadge status={v.status} />
                  </p>
                  <p className="text-muted-foreground">
                    {[v.projectName, v.unitCode, v.agentName].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {v.outcome ? <p className="whitespace-pre-line">{v.outcome}</p> : null}
                </div>
                {editable ? (
                  <RecordVisitDialog
                    visitId={v.id}
                    scheduledAt={v.scheduledAt}
                    status={v.status}
                    outcome={v.outcome}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Duplicates({ lead, ctx }: { lead: LeadDetail; ctx: TenantCtx }) {
  const t = useTranslations("crm");
  const merge = can(ctx.roles, "lead:merge");
  return (
    <Card className="border-amber-300 bg-amber-50/60" data-testid="lead-duplicates">
      <CardContent className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
          <AlertTriangle className="size-4" aria-hidden />
          {t("leads.duplicatesAlert", { count: lead.duplicateCount })}
          {!merge ? ` ${t("leads.duplicatesAgentHint")}` : ""}
        </p>
        {lead.duplicates.length > 0 ? (
          <ul className="divide-y rounded-md border bg-background">
            {lead.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-2.5">
                <div className="text-sm">
                  <Link href={`/leads/${d.id}`} className="font-medium hover:underline">
                    {d.fullName}
                  </Link>{" "}
                  · <PhoneText value={d.phone} /> · {d.assigneeName ?? t("leads.unassigned")}{" "}
                  <LeadStageBadge stage={d.stage} className="ms-1" />
                </div>
                {merge ? (
                  <ConfirmAction
                    action={mergeLeadsAction}
                    input={{ targetId: lead.id, sourceId: d.id }}
                    label={t("leads.merge")}
                    title={t("leads.mergeTitle", { source: d.fullName })}
                    description={t("leads.mergeDescription")}
                    confirmLabel={t("leads.merge")}
                    successMessage={t("leads.merged")}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QuotationsCard({
  leadId,
  quotations,
  canCreate,
}: {
  leadId: string;
  quotations: Awaited<ReturnType<typeof listLeadQuotations>>;
  canCreate: boolean;
}) {
  const t = useTranslations("quotations");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const today = todayInAlgiers();
  return (
    <Card data-testid="lead-quotations">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        {canCreate ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/leads/${leadId}/quotations/new`}>
              <FileText data-icon="inline-start" />
              {t("new")}
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {quotations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="divide-y">
            {quotations.map((q) => {
              const state = quotationState(q, today);
              return (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="space-y-0.5">
                    <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">
                      {q.number}
                    </Link>
                    <p className="text-muted-foreground">
                      {q.projectName} · <bdi dir="ltr">{q.unitCode}</bdi> ·{" "}
                      {t("validUntil", { date: formatDate(q.validUntil) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="font-medium whitespace-nowrap">
                      {formatDZD(q.price, locale)}
                    </span>
                    <Badge variant={state === "issued" ? "default" : "secondary"}>
                      {t(`status.${state}`)}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
